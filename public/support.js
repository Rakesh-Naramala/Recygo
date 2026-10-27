(function () {
  const STORAGE_KEY = 'recygo_profile';

  function getPersona() {
    const select = document.getElementById('persona-switcher');
    if (!select) return 'seller';
    return select.value || 'seller';
  }

  function getProfile() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (error) {
      return {};
    }
  }

  function saveProfile(profile) {
    if (!profile || !profile.role) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  }

  function updateSupportAccess() {
    const supportBtn = document.getElementById('support-btn');
    if (!supportBtn) return;

    const allowed = ['seller', 'buyer'].includes(getPersona());
    supportBtn.classList.toggle('hidden', !allowed);
  }

  function openSupportPanel() {
    const modal = document.getElementById('support-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
  }

  function closeSupportPanel() {
    const modal = document.getElementById('support-modal');
    if (!modal) return;
    modal.classList.add('hidden');
  }

  function switchSupportTab(tabName) {
    const tabs = document.querySelectorAll('.support-tab');
    const panels = document.querySelectorAll('.support-panel');

    tabs.forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.supportTab === tabName);
    });

    panels.forEach((panel) => {
      panel.classList.toggle('active', panel.id === `support-${tabName}`);
    });
  }

  function validatePasswordFields() {
    const current = document.getElementById('current-password')?.value || '';
    const next = document.getElementById('new-password')?.value || '';
    const confirm = document.getElementById('confirm-new-password')?.value || '';

    if (!current || !next || !confirm) {
      alert('Please fill all password fields.');
      return false;
    }

    if (next.length < 6) {
      alert('Password must be at least 6 characters long.');
      return false;
    }

    if (next !== confirm) {
      alert('New passwords do not match.');
      return false;
    }

    return true;
  }

  function savePasswordChange() {
    if (!validatePasswordFields()) return;

    const profile = getProfile();
    if (!profile || !profile.password) {
      alert('No saved password found for this user. Please set a password during registration.');
      return;
    }

    const current = document.getElementById('current-password').value;
    if (profile.password !== current) {
      alert('Current password is incorrect.');
      return;
    }

    const newPassword = document.getElementById('new-password').value;
    profile.password = newPassword;
    saveProfile(profile);

    document.getElementById('current-password').value = '';
    document.getElementById('new-password').value = '';
    document.getElementById('confirm-new-password').value = '';

    alert('Password updated successfully.');
    closeSupportPanel();
  }

  function captureRegistration(role, name, phone, password) {
    if (!name || !phone) return;

    if (!password || password.length < 6) {
      alert('Please use a password with at least 6 characters.');
      return;
    }

    const profile = {
      role,
      name,
      phone,
      password
    };

    saveProfile(profile);
  }

  function patchRegistrationFunction(fnName, role) {
    const original = window[fnName];
    if (typeof original !== 'function') return;

    window[fnName] = function (...args) {
      const result = original.apply(this, args);
      const name = document.getElementById(`${role}-name`)?.value?.trim() || '';
      const phone = document.getElementById(`${role}-phone`)?.value?.trim() || '';
      const password = document.getElementById(`${role}-password`)?.value || '';
      const confirm = document.getElementById(`${role}-confirm-password`)?.value || '';

      if (!name || !phone) return result;
      if (!password || password.length < 6) {
        alert('Password must be at least 6 characters long.');
        return result;
      }
      if (password !== confirm) {
        alert('Passwords do not match.');
        return result;
      }

      captureRegistration(role, name, phone, password);
      return result;
    };
  }

  function bindSupportActions() {
    const tabs = document.querySelectorAll('.support-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => switchSupportTab(tab.dataset.supportTab));
    });

    const supportBtn = document.getElementById('support-btn');
    if (supportBtn) {
      supportBtn.addEventListener('click', openSupportPanel);
    }

    const persona = document.getElementById('persona-switcher');
    if (persona) {
      persona.addEventListener('change', updateSupportAccess);
    }

    const overlay = document.getElementById('support-modal');
    if (overlay) {
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closeSupportPanel();
      });
    }
  }

  function init() {
    updateSupportAccess();
    bindSupportActions();
    patchRegistrationFunction('registerSeller', 'seller');
    patchRegistrationFunction('registerBuyer', 'buyer');

    window.openSupportPanel = openSupportPanel;
    window.closeSupportPanel = closeSupportPanel;
    window.switchSupportTab = switchSupportTab;
    window.savePasswordChange = savePasswordChange;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
