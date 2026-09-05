// ============================================
// EduPusula Landing Page - JavaScript
// ============================================

document.addEventListener('DOMContentLoaded', function() {
  // ---- NAVBAR TOGGLE ----
  const navbarToggle = document.getElementById('navbar-toggle');
  const navbarMenu = document.getElementById('navbar-menu');

  if (navbarToggle) {
    navbarToggle.addEventListener('click', function() {
      navbarMenu.classList.toggle('active');
    });
  }

  // Menü öğelerine tıklandığında menüyü kapat
  const navbarLinks = document.querySelectorAll('.navbar-link');
  navbarLinks.forEach(link => {
    link.addEventListener('click', function() {
      navbarMenu.classList.remove('active');
    });
  });

  // ---- SCROLL ANIMASYONLARI ----
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -100px 0px'
  };

  const observer = new IntersectionObserver(function(entries) {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  // Animasyon yapılacak elementleri seç
  const animateElements = document.querySelectorAll(
    '.audience-card, .feature-card, .stepper-item'
  );

  animateElements.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
    observer.observe(el);
  });

  // ---- SMOOTH SCROLL ----
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });

  // ---- NAVBAR SCROLL EFEKTI ----
  const navbar = document.querySelector('.navbar');
  let lastScrollTop = 0;

  window.addEventListener('scroll', function() {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

    if (scrollTop > 50) {
      navbar.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.1)';
    } else {
      navbar.style.boxShadow = 'none';
    }

    lastScrollTop = scrollTop <= 0 ? 0 : scrollTop;
  });

  // ---- BUTTON HOVERs ----
  const buttons = document.querySelectorAll('.btn-primary, .btn-secondary');
  buttons.forEach(btn => {
    btn.addEventListener('mouseenter', function() {
      this.style.transform = 'translateY(-2px)';
    });

    btn.addEventListener('mouseleave', function() {
      this.style.transform = 'translateY(0)';
    });
  });

  // ---- COMPASS SVG DÖNÜŞ ANIMASYONU ----
  const compassSvg = document.querySelector('.compass-svg');
  if (compassSvg) {
    let rotation = 0;
    setInterval(() => {
      rotation += 0.2;
      compassSvg.style.transform = `rotate(${rotation}deg)`;
    }, 50);
  }

  // ---- RESPONSIVE NAVBAR ----
  function handleResize() {
    if (window.innerWidth > 768) {
      navbarMenu.classList.remove('active');
    }
  }

  window.addEventListener('resize', handleResize);

  // ---- CHART BAR ANIMASYONLARI ----
  const chartBars = document.querySelectorAll('.chart-bar');
  let chartAnimated = false;

  const chartObserver = new IntersectionObserver(function(entries) {
    entries.forEach(entry => {
      if (entry.isIntersecting && !chartAnimated) {
        chartBars.forEach((bar, index) => {
          bar.style.animation = `growUp 0.8s ease-out ${index * 0.1}s forwards`;
        });
        chartAnimated = true;
      }
    });
  }, { threshold: 0.5 });

  const dashboardCard = document.querySelector('.dashboard-card');
  if (dashboardCard) {
    chartObserver.observe(dashboardCard);
  }

  // ---- COUNTER ANIMASYONU (İsteğe bağlı) ----
  function animateCounter(element, target, duration = 2000) {
    let current = 0;
    const increment = target / (duration / 16);

    const interval = setInterval(() => {
      current += increment;
      if (current >= target) {
        element.textContent = target;
        clearInterval(interval);
      } else {
        element.textContent = Math.floor(current);
      }
    }, 16);
  }

  // ---- CHAT MESAJLARI ANIMASYONU ----
  const chatMessages = document.querySelectorAll('.chat-message');
  chatMessages.forEach((msg, index) => {
    msg.style.animation = `fadeIn 0.6s ease-out ${index * 0.2}s backwards`;
  });

  // ---- SUBJECT PROGRESS BAR ANIMASYONU ----
  const subjectProgress = document.querySelectorAll('.subject-progress');
  let progressAnimated = false;

  const progressObserver = new IntersectionObserver(function(entries) {
    entries.forEach(entry => {
      if (entry.isIntersecting && !progressAnimated) {
        subjectProgress.forEach((bar) => {
          const width = bar.style.width;
          bar.style.width = '0';
          bar.style.transition = 'width 1s ease-out';
          
          setTimeout(() => {
            bar.style.width = width;
          }, 100);
        });
        progressAnimated = true;
      }
    });
  }, { threshold: 0.5 });

  const dashboardSubjects = document.querySelector('.dashboard-subjects');
  if (dashboardSubjects) {
    progressObserver.observe(dashboardSubjects);
  }

  // ---- HOVER EFEKTLERI ----
  const cards = document.querySelectorAll('.audience-card, .feature-card');
  cards.forEach(card => {
    card.addEventListener('mouseenter', function() {
      this.style.boxShadow = '0 20px 50px rgba(37, 99, 235, 0.2)';
    });

    card.addEventListener('mouseleave', function() {
      this.style.boxShadow = '';
    });
  });

  // ---- AKTİF NAV LİNK ----
  const navLinks = document.querySelectorAll('.navbar-link');
  window.addEventListener('scroll', () => {
    const sections = document.querySelectorAll('section');
    let currentSection = '';

    sections.forEach(section => {
      const sectionTop = section.offsetTop;
      if (pageYOffset >= sectionTop - 200) {
        currentSection = section.getAttribute('id');
      }
    });

    navLinks.forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('href').slice(1) === currentSection) {
        link.style.color = 'var(--primary-blue)';
      } else {
        link.style.color = '';
      }
    });
  });

  // ---- GİRİŞ MODALI ----
  const loginOverlay = document.getElementById('login-modal-overlay');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const loginSubmitBtn = document.getElementById('login-submit-btn');
  const loginClose = document.getElementById('login-modal-close');

  function openLoginModal() {
    if (!loginOverlay) return;
    loginOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    const first = document.getElementById('login-username');
    if (first) first.focus();
  }

  function closeLoginModal() {
    if (!loginOverlay) return;
    loginOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  document.querySelectorAll('[data-login-trigger]').forEach(trigger => {
    trigger.addEventListener('click', function(e) {
      e.preventDefault();
      openLoginModal();
    });
  });

  if (loginClose) loginClose.addEventListener('click', closeLoginModal);
  if (loginOverlay) {
    loginOverlay.addEventListener('click', function(e) {
      if (e.target === loginOverlay) closeLoginModal();
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      loginError.style.display = 'none';
      loginSubmitBtn.disabled = true;
      loginSubmitBtn.textContent = 'Giriş yapılıyor...';

      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: document.getElementById('login-username').value.trim(),
            password: document.getElementById('login-password').value,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Giriş başarısız.');

        if (data.role === 'admin' || data.role === 'super_admin') window.location.href = '/';
        else if (data.role === 'teacher' && data.isDelegateAdmin) window.location.href = '/';
        else if (data.role === 'teacher') window.location.href = '/ogretmen.html';
        else if (data.role === 'parent') window.location.href = '/veli.html';
        else if (data.role === 'student') window.location.href = '/ogrenci.html';
        else window.location.href = '/';
      } catch (err) {
        loginError.textContent = err.message;
        loginError.style.display = 'block';
        loginSubmitBtn.disabled = false;
        loginSubmitBtn.textContent = 'Giriş Yap';
      }
    });
  }

  console.log('✅ EduPusula Landing Page Yüklendi!');
});

// ---- KEYBOARD NAVIGATION ----
document.addEventListener('keydown', function(event) {
  if (event.key === 'Escape') {
    const navbarMenu = document.getElementById('navbar-menu');
    if (navbarMenu) {
      navbarMenu.classList.remove('active');
    }
    const loginOverlay = document.getElementById('login-modal-overlay');
    if (loginOverlay && loginOverlay.classList.contains('active')) {
      loginOverlay.classList.remove('active');
      document.body.style.overflow = '';
    }
  }
});
