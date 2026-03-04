export function createToaster(container) {
  function toast(message, { ttl = 2600 } = {}) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    container.appendChild(el);
    window.setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(4px)';
      el.style.transition = 'opacity 160ms ease, transform 160ms ease';
      window.setTimeout(() => el.remove(), 200);
    }, ttl);
  }

  return { toast };
}
