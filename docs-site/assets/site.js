// Progressive enhancement for the EcoLume documentation site.
// Everything here is optional: the pages are readable without JavaScript.
(() => {
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  /* Theme toggle — remembers the reader's choice, otherwise follows the OS. */
  const storedTheme = (() => {
    try { return localStorage.getItem('ecolume-theme'); } catch { return null; }
  })();
  if (storedTheme === 'light' || storedTheme === 'dark') root.dataset.theme = storedTheme;

  document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    const dark = !matchMedia('(prefers-color-scheme: light)').matches;
    const current = root.dataset.theme || (dark ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('ecolume-theme', next); } catch { /* private mode */ }
  });

  /* Mobile navigation */
  const navToggle = document.querySelector('[data-nav-toggle]');
  const navLinks = document.getElementById('nav-links');
  navToggle?.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(open));
  });

  /* Reveal-on-scroll */
  const revealables = document.querySelectorAll('[data-reveal]');
  if (reduced.matches || !('IntersectionObserver' in window)) {
    revealables.forEach((el) => el.classList.add('shown'));
  } else {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('shown');
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    revealables.forEach((el) => observer.observe(el));
  }

  /* Pointer-following card glow */
  if (!reduced.matches) {
    for (const card of document.querySelectorAll('.card')) {
      card.addEventListener('pointermove', (event) => {
        const box = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${event.clientX - box.left}px`);
        card.style.setProperty('--my', `${event.clientY - box.top}px`);
      });
    }
  }

  /* Copy buttons for code samples */
  for (const pre of document.querySelectorAll('.prose pre')) {
    if (!navigator.clipboard) break;
    const button = document.createElement('button');
    button.className = 'icon-btn btn-sm copy-btn';
    button.type = 'button';
    button.textContent = 'Copy';
    button.style.width = 'auto';
    button.setAttribute('aria-label', 'Copy code to clipboard');
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(pre.innerText.trim());
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = 'Copy'; }, 1600);
    });
    pre.append(button);
  }

  /* Table-of-contents scroll spy */
  const tocLinks = [...document.querySelectorAll('.doc-toc a')];
  if (tocLinks.length && 'IntersectionObserver' in window) {
    const byId = new Map(tocLinks.map((link) => [link.hash.slice(1), link]));
    const headings = [...document.querySelectorAll('.prose h2[id], .prose h3[id]')]
      .filter((heading) => byId.has(heading.id));
    const visible = new Set();
    const spy = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      }
      const active = headings.find((heading) => visible.has(heading.id));
      for (const link of tocLinks) link.classList.toggle('active', link.hash === `#${active?.id}`);
    }, { rootMargin: '-80px 0px -70% 0px' });
    headings.forEach((heading) => spy.observe(heading));
  }
})();
