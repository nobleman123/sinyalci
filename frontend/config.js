(function() {
  const CANONICAL_URL = 'https://sinyalci-worker.succimer.workers.dev';
  const LEGACY_KEYS = ['sinyalci_workerUrl', 'nexus_backendUrl'];

  for (const key of LEGACY_KEYS) {
    const stored = localStorage.getItem(key);
    if (stored && stored.includes('onrender.com')) {
      localStorage.removeItem(key);
      console.log(`[Config] Cleared legacy Render URL from ${key}.`);
    }
  }

  const workerUrl = localStorage.getItem('sinyalci_workerUrl') || CANONICAL_URL;
  localStorage.setItem('sinyalci_workerUrl', workerUrl);
  localStorage.setItem('nexus_backendUrl', workerUrl);

  window.SINYALCI_CONFIG = {
    WORKER_URL: workerUrl,
    VERSION: '2.2.0'
  };
})();
