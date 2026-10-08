customElements.define('image-slot', class extends HTMLElement {
  static get observedAttributes() { return ['src', 'alt']; }

  connectedCallback() {
    this._render();
  }

  attributeChangedCallback() {
    this._render();
  }

  _render() {
    const src = this.getAttribute('src');
    const placeholder = this.getAttribute('placeholder') || '';
    const shape = this.getAttribute('shape') || 'rounded';
    const radius = this.getAttribute('radius') || '8';

    this.style.display = 'block';
    this.style.overflow = 'hidden';
    this.style.position = 'relative';
    this.style.borderRadius = shape === 'circle' ? '50%' : `${radius}px`;

    if (src) {
      this.innerHTML = `<img src="${src}" alt="${this.getAttribute('alt') || placeholder}" style="width:100%;height:100%;object-fit:cover;display:block;" loading="lazy" />`;
    } else {
      this.innerHTML = `<div style="width:100%;height:100%;min-height:64px;background:linear-gradient(135deg,#16161a,#0c0c0e);display:flex;align-items:center;justify-content:center;"><span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#71717a;letter-spacing:0.08em;text-align:center;padding:8px;">${placeholder}</span></div>`;
    }
  }
});
