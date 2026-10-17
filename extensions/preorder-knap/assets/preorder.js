// Lalatoto Forudbestilling: sætter forudbestillingsplanen på produktets
// læg-i-kurv-formular og holder den i takt med valgt variant.
//
// Temaer bygger formularen forskelligt, så blokken finder selv formularerne
// i sin sektion (form[action*="/cart/add"]) og lytter på variant-feltet
// (name="id"). Et skjult felt name="selling_plan" er det, Shopify bruger til at
// lægge varen i kurven som forudbestilling.
(() => {
  if (customElements.get('lalatoto-preorder')) return;

  class LalatotoPreorder extends HTMLElement {
    connectedCallback() {
      try {
        this.config = JSON.parse(this.querySelector('[data-preorder-config]').textContent);
      } catch (error) {
        console.warn('Lalatoto Forudbestilling: ugyldig konfiguration', error);
        return;
      }
      this.textEl = this.querySelector('[data-preorder-text]');
      this.isCustom = this.classList.contains('lalatoto-preorder--custom');
      this.originalButtonText = new WeakMap();
      this.update = this.update.bind(this);

      const scope = this.closest('.shopify-section') || document;
      this.forms = [...scope.querySelectorAll('form[action*="/cart/add"]')];
      if (this.forms.length === 0) {
        // Nogle temaer lægger formularen uden for blokkens sektion.
        this.forms = [...document.querySelectorAll('form[action*="/cart/add"]')];
      }

      this.observers = [];
      for (const form of this.forms) {
        form.addEventListener('change', this.update);
        const idInput = form.querySelector('[name="id"]');
        if (idInput) {
          // Temaer skifter variant ved at sætte value uden at sende en hændelse.
          const observer = new MutationObserver(this.update);
          observer.observe(idInput, { attributes: true, attributeFilter: ['value'] });
          this.observers.push(observer);
        }
        const button = this.submitButton(form);
        if (button && (this.config.buttonText || this.isCustom)) {
          // Temaet skriver selv knappens tekst om ved variantskift («Udsolgt»
          // osv.). Skriv vores tekst ind igen bagefter.
          const observer = new MutationObserver(() => this.applyButton(form));
          observer.observe(button, { childList: true, subtree: true, characterData: true });
          this.observers.push(observer);
        }
      }
      this.update();
    }

    disconnectedCallback() {
      for (const form of this.forms || []) form.removeEventListener('change', this.update);
      for (const observer of this.observers || []) observer.disconnect();
    }

    submitButton(form) {
      return form.querySelector('button[type="submit"][name="add"], button[type="submit"]');
    }

    /** Den del af knappen, der bærer teksten. Rører ikke spinnere og ikoner. */
    buttonLabel(button) {
      const span = [...button.children].find((el) => el.tagName === 'SPAN' && el.textContent.trim());
      if (span) return span;
      return button.children.length === 0 ? button : null;
    }

    currentEntry(form) {
      const idInput = form.querySelector('[name="id"]');
      return idInput ? this.config.variants[String(idInput.value)] : undefined;
    }

    /**
     * «Køb nu»-knapperne (Shop Pay, «Buy it now» osv.). Shopify lægger dem i
     * .shopify-payment-button, i formularen eller lige ved siden af den.
     */
    paymentButtons(form) {
      const inside = [...form.querySelectorAll('.shopify-payment-button')];
      if (inside.length > 0 || !form.parentElement) return inside;
      return [...form.parentElement.querySelectorAll('.shopify-payment-button')];
    }

    applyButton(form) {
      const entry = this.currentEntry(form);
      // En forudbestilling skal gennem kurven, så kunden ser vilkårene og
      // planen følger med. «Køb nu» skjules, kun mens varianten forudbestilles.
      for (const el of this.paymentButtons(form)) {
        el.classList.toggle('lalatoto-preorder-no-express', Boolean(entry));
      }
      const button = this.submitButton(form);
      if (!button) return;
      if (this.isCustom) {
        // Egen stil: knappen får dashboardets farver, men kun når varianten
        // forudbestilles. Variablerne kopieres fra blokken.
        button.classList.toggle('lalatoto-preorder-button', Boolean(entry));
        for (const name of ['--lp-accent', '--lp-accent-text', '--lp-radius']) {
          button.style.setProperty(name, this.style.getPropertyValue(name));
        }
      }
      if (!this.config.buttonText) return;
      const label = this.buttonLabel(button);
      if (!label || button.disabled) return;
      const wanted = entry ? this.config.buttonText : this.originalButtonText.get(label);
      if (!this.originalButtonText.has(label) && entry) {
        this.originalButtonText.set(label, label.textContent.trim());
      }
      if (wanted && label.textContent.trim() !== wanted) label.textContent = wanted;
    }

    update() {
      let shown = false;
      for (const form of this.forms) {
        const entry = this.currentEntry(form);
        let input = form.querySelector('input[name="selling_plan"][data-lalatoto-preorder]');
        if (entry) {
          if (!input) {
            input = document.createElement('input');
            input.type = 'hidden';
            input.name = 'selling_plan';
            input.dataset.lalatotoPreorder = '';
            form.appendChild(input);
          }
          input.value = String(entry.plan);
          shown = true;
          if (this.textEl) this.textEl.textContent = this.renderText(entry.deposit);
        } else if (input) {
          input.remove();
        }
        this.applyButton(form);
      }
      this.hidden = !shown;
    }

    renderText(deposit) {
      return (this.dataset.infoTemplate || '')
        .replaceAll('{dato}', this.dataset.dateText || '')
        .replaceAll('{depositum}', deposit || '');
    }
  }

  customElements.define('lalatoto-preorder', LalatotoPreorder);
})();
