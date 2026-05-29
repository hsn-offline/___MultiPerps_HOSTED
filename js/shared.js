/* shared.js — Loaded on every page
   1. Auto-highlights current page in the site-header nav
   2. Footer "loaded" animation
   3. Hide site-header on scroll down, show on scroll up (all screen sizes)
*/

(function () {
  'use strict';

  function init() {

    /* ── 1. Auto-highlight active nav link ── */
    try {
      var path = window.location.pathname;
      var page = path.substring(path.lastIndexOf('/') + 1) || 'index.html';
      var links = document.querySelectorAll('.site-header nav a');
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute('href') || '';
        if (href === page) {
          links[i].classList.add('active');
        } else {
          links[i].classList.remove('active');
        }
      }
    } catch (e) { /* ignore */ }

    /* ── 2. Footer loaded animation ── */
    try {
      var footer = document.querySelector('.site-footer');
      if (footer) footer.classList.add('loaded');
    } catch (e) { /* ignore */ }

    /* ── 3. Hide site-header on scroll down, show on scroll up (all screen sizes) ── */
    var header = document.querySelector('.site-header');
    if (header) {
      var lastScrollY = window.scrollY || 0;
      var ticking = false;
      var HIDE_THRESHOLD = 60;

      function onScroll() {
        if (!ticking) {
          window.requestAnimationFrame(function () {
            var currentScrollY = window.scrollY || window.pageYOffset;

            if (currentScrollY > HIDE_THRESHOLD) {
              if (currentScrollY > lastScrollY) {
                header.classList.add('header-hidden');
              } else {
                header.classList.remove('header-hidden');
              }
            } else {
              header.classList.remove('header-hidden');
            }

            lastScrollY = currentScrollY;
            ticking = false;
          });
          ticking = true;
        }
      }

      window.addEventListener('scroll', onScroll, { passive: true });
    }

  }

  /* Run init when DOM is ready */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
