document.addEventListener('DOMContentLoaded', () => {
    const apiEndpointInput = document.getElementById('apiEndpoint');
    const apiKeyInput = document.getElementById('apiKey');
    const saveBtn = document.getElementById('saveBtn');
    const status = document.getElementById('status');
    
    // Load saved settings
    chrome.storage.sync.get(['apiEndpoint', 'apiKey'], (result) => {
      if (result.apiEndpoint) {
        apiEndpointInput.value = result.apiEndpoint;
      }
      if (result.apiKey) {
        apiKeyInput.value = result.apiKey;
      }
    });
    
    // Save settings
    saveBtn.addEventListener('click', () => {
      const apiEndpoint = apiEndpointInput.value.trim();
      const apiKey = apiKeyInput.value.trim();
      
      chrome.storage.sync.set({ apiEndpoint, apiKey }, () => {
        status.className = 'status success';
        status.textContent = '✓ Settings saved successfully!';
        
        setTimeout(() => {
          status.textContent = '';
          status.className = 'status';
        }, 2000);
      });
    });
  });