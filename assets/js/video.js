// Video lightbox — inject iframe on play, clear on close
export function initVideo() {
  const triggers = document.querySelectorAll('[data-video]');
  const modal = document.getElementById('video-modal');
  const frame = document.getElementById('video-modal-frame');
  if (!triggers.length || !modal || !frame) return;

  triggers.forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.video;
      frame.innerHTML = `<iframe src="${url}" title="Resort video" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
      modal.hidden = false;
      document.body.style.overflow = 'hidden';
    });
  });

  const close = () => {
    modal.hidden = true;
    frame.innerHTML = '';
    document.body.style.overflow = '';
  };

  modal.querySelectorAll('[data-video-close]').forEach((el) => {
    el.addEventListener('click', close);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) close();
  });
}
