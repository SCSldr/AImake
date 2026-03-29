document.querySelectorAll('.choice-card').forEach((card) => {
    card.addEventListener('mouseenter', () => card.classList.add('shadow-lg'));
    card.addEventListener('mouseleave', () => card.classList.remove('shadow-lg'));
});

