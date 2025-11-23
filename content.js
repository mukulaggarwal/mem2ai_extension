let refineButton = null;
let isProcessing = false;
let shadowContainer = null;
let shadowRoot = null;
let positionObserver = null;
let runnerBar = null;

// Configuration - Update this with your backend API endpoint
const API_CONFIG = {
  // endpoint: 'http://127.0.0.1:8000/v1/refine',
  endpoint: 'https://optimus.mem2ai.com/v1/refine',
  apiKey: 'YOUR_API_KEY' // Store this securely or get from chrome.storage
};

// const website_url = 'http://127.0.0.1:5000';
const website_url = 'https://mem2ai.com';

// If we're on the home site, capture its token into extension storage
if (window.location.origin === 'http://127.0.0.1:5000' || window.location.origin === 'https://mem2ai.com' || window.location.origin === 'https://www.mem2ai.com') {
  const homeToken = localStorage.getItem('mem2aiusertoken');
  if (homeToken) {
    chrome.storage.local.set({ mem2aiusertoken: homeToken });
  }
}

async function getUserTokenWithSync() {
  // Try page-local storage first
  const localToken = localStorage.getItem('mem2aiusertoken');
  if (localToken) return localToken;

  // Then try extension storage
  const storedToken = await new Promise((resolve) => {
    chrome.storage.local.get(['mem2aiusertoken'], (result) => resolve(result.mem2aiusertoken || null));
  });
  if (storedToken) {
    try { localStorage.setItem('mem2aiusertoken', storedToken); } catch (e) { console.warn('Unable to cache mem2aiusertoken locally:', e); }
    return storedToken;
  }

  // No token found – show login modal and let user decide
  showLoginModal();
  return null;
}

// Detect which site we're on and get the appropriate selectors
function getSiteConfig() {
  const hostname = window.location.hostname;
  console.log(hostname);
  
  if (hostname.includes('chatgpt.com')) {
    console.log('ChatGPT');
    return {
      name: 'ChatGPT',
      textareaSelector: '#prompt-textarea',
      sendButtonSelector: 'button[data-testid="send-button"]',
      messageSelector: '[data-message-author-role]',
      inputContainerSelector: 'form'
    };
  } else if (hostname.includes('claude.ai')) {
    return {
      name: 'Claude',
      textareaSelector: 'div[contenteditable="true"]',
      sendButtonSelector: 'button[aria-label*="Send"]',
      messageSelector: '[data-test-render-count]',
      inputContainerSelector: 'fieldset'
    };
  } else if (hostname.includes('gemini.google.com')) {
    console.log('Site detected: Gemini');
    return {
      name: 'Gemini',
      // Gemini's input area - try multiple selectors to be more robust
      textareaSelector: 'textarea[aria-label*="Enter a prompt"], textarea[placeholder*="Enter a prompt"], div[contenteditable="true"][aria-label*="prompt"], .ql-editor[contenteditable="true"]',
      // The send button selector - multiple possible selectors
      sendButtonSelector: 'button[aria-label*="Send"], button[data-testid="send-button"], button.send-button, button[type="submit"]',
      // Message selectors - Gemini uses different structures
      messageSelector: '[data-message-author-role], [data-message-index], .message-content, .model-response-text, .user-input-text',
      // Additional selectors for identifying message types
      userMessageSelector: '[data-message-author-role="user"], .user-message, .user-input',
      assistantMessageSelector: '[data-message-author-role="model"], .model-response, .model-message',
      // The container for the input
      inputContainerSelector: 'form, .input-container, .prompt-box, [role="textbox"]'
    };
  }
  
  return null;
}

// Extract message history from the page
function extractMessageHistory(config) {
  const messages = [];
  
  // Handle Gemini-specific extraction
  if (config.name === 'Gemini') {
    // Try to get user messages
    if (config.userMessageSelector) {
      const userMessages = document.querySelectorAll(config.userMessageSelector);
      userMessages.forEach(el => {
        const text = el.innerText.trim();
        if (text) {
          messages.push({ role: 'user', content: text });
        }
      });
    }
    
    // Try to get assistant/model messages
    if (config.assistantMessageSelector) {
      const assistantMessages = document.querySelectorAll(config.assistantMessageSelector);
      assistantMessages.forEach(el => {
        const text = el.innerText.trim();
        if (text) {
          messages.push({ role: 'assistant', content: text });
        }
      });
    }
    
    // Fallback: try generic message selector with heuristics
    if (messages.length === 0 && config.messageSelector) {
      const messageElements = document.querySelectorAll(config.messageSelector);
      messageElements.forEach(el => {
        // Check for explicit role attribute
        let role = el.getAttribute('data-message-author-role');
        
        // If no role, try to infer from structure
        if (!role) {
          // Check parent/ancestor classes/attributes
          const parent = el.closest('[data-role], [aria-label*="user"], [aria-label*="model"]');
          if (parent) {
            const roleAttr = parent.getAttribute('data-role') || parent.getAttribute('aria-label') || '';
            if (roleAttr.toLowerCase().includes('user')) role = 'user';
            else if (roleAttr.toLowerCase().includes('model')) role = 'assistant';
          }
          
          // Last resort: check if element contains certain indicators
          if (!role) {
            const className = el.className || '';
            const hasModelIndicator = className.includes('model') || className.includes('assistant') || className.includes('response');
            role = hasModelIndicator ? 'assistant' : 'user';
          }
        }
        
        const text = el.innerText.trim();
        if (text && role) {
          messages.push({ role, content: text });
        }
      });
    }
  } else {
    // Original logic for ChatGPT and Claude
    const messageElements = document.querySelectorAll(config.messageSelector);
    
    messageElements.forEach(el => {
      const role = el.getAttribute('data-message-author-role') || 
                   (el.querySelector('[data-test-render-count]') ? 'assistant' : 'user');
      const text = el.innerText.trim();
      
      if (text) {
        messages.push({ role, content: text });
      }
    });
  }
  
  return messages;
}

// Get current prompt text
function getCurrentPrompt(config) {
  // For Gemini, try multiple selectors
  let textarea = null;
  
  if (config.name === 'Gemini') {
    // Try selectors in order of preference
    const selectors = config.textareaSelector.split(', ').map(s => s.trim());
    for (const selector of selectors) {
      textarea = document.querySelector(selector);
      if (textarea) break;
    }
  } else {
    textarea = document.querySelector(config.textareaSelector);
  }
  
  if (!textarea) return '';
  
  // Handle contenteditable divs (like Claude and Gemini)
  if (textarea.contentEditable === 'true' || textarea.getAttribute('contenteditable') === 'true') {
    return textarea.innerText.trim() || textarea.textContent.trim();
  }
  
  // Handle regular textareas (like ChatGPT)
  return textarea.value.trim();
}

// Set prompt text
function setPrompt(config, text) {
  let textarea = null;
  
  // For Gemini, try multiple selectors
  if (config.name === 'Gemini') {
    const selectors = config.textareaSelector.split(', ').map(s => s.trim());
    for (const selector of selectors) {
      textarea = document.querySelector(selector);
      if (textarea) break;
    }
  } else {
    textarea = document.querySelector(config.textareaSelector);
  }
  
  if (!textarea) return;
  
  // Handle contenteditable divs (like Claude and Gemini)
  if (textarea.contentEditable === 'true' || textarea.getAttribute('contenteditable') === 'true') {
    // Clear existing content
    textarea.innerHTML = '';
    textarea.innerText = text;
    
    // For contenteditable, we may need to trigger multiple events
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('keydown', { bubbles: true, key: ' ' }));
    textarea.dispatchEvent(new Event('keyup', { bubbles: true, key: ' ' }));
    
    // Some sites need textContent instead
    if (!textarea.innerText) {
      textarea.textContent = text;
    }
  } else {
    // Handle regular textareas (like ChatGPT)
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  }
  
  // Focus the textarea and trigger a click to ensure it's active
  textarea.focus();
  textarea.click();
  
  // For some sites, we need to trigger additional events after a short delay
  setTimeout(() => {
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }, 100);
}

// Call backend API to refine the prompt
async function refinePrompt(currentPrompt, messageHistory, mem2aiusertoken) {
  try {
    const response = await fetch(API_CONFIG.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'mem2aiusertoken': mem2aiusertoken
      },
      body: JSON.stringify({
        current_prompt: currentPrompt,
        history: messageHistory
      })
    });
    
    if (!response.ok) {
      let detailMessage = '';
      try {
        const errorData = await response.clone().json();
        detailMessage = errorData?.detail || errorData?.message || '';
      } catch (e) {
        // ignore JSON parse errors
      }

      const isAuthError = response.status === 401 || /invalid token/i.test(detailMessage);

      if (isAuthError) {
        showNotification('Please sign in again to Mem2AI', 'error');
      } else if (detailMessage) {
        showNotification(detailMessage, 'error');
      } else {
        showNotification(`API error: ${response.status}`, 'error');
      }

      // For any 4xx error, prompt the user to sign in via modal
      if (response.status >= 400 && response.status < 500) {
        showLoginModal();
      }

      throw new Error(detailMessage || `API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.updated_prompt  || currentPrompt;
  } catch (error) {
    console.error('Error refining prompt:', error);
    throw error;
  }
}

// Create and inject the refine button
function createRefineButton(config) {
  const button = document.createElement('button');
  button.id = 'prompt-refiner-btn';
  button.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 20h9"></path>
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
    </svg>
    <span>Refine</span>
  `;
  button.setAttribute('part', 'btn');
  button.title = 'Refine your prompt';
  button.style.all = 'unset';
  button.style.boxSizing = 'border-box';
  button.style.display = 'inline-flex';
  button.style.alignItems = 'center';
  button.style.justifyContent = 'center';
  button.style.gap = '8px';
  button.style.padding = '14px 20px';
  button.style.borderRadius = '28px';
  button.style.border = 'none';
  button.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
  button.style.color = '#ffffff';
  button.style.cursor = 'pointer';
  button.style.font = '600 14px ui-sans-serif, system-ui, -apple-system';
  button.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4), 0 2px 4px rgba(0, 0, 0, 0.1)';
  button.style.transition = 'all 0.2s ease';
  button.style.userSelect = 'none';
  
  // Hover effect
  button.addEventListener('mouseenter', () => {
    if (!isProcessing) {
      button.style.transform = 'translateY(-2px)';
      button.style.boxShadow = '0 6px 16px rgba(102, 126, 234, 0.5), 0 2px 4px rgba(0, 0, 0, 0.1)';
    }
  });
  
  button.addEventListener('mouseleave', () => {
    if (!isProcessing) {
      button.style.transform = 'translateY(0)';
      button.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4), 0 2px 4px rgba(0, 0, 0, 0.1)';
    }
  });

  button.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (isProcessing) return;

    const mem2aiusertoken = await getUserTokenWithSync();
    if (!mem2aiusertoken) {
      showNotification('User not logged in. Please sign in on the Mem2AI site.', 'error');
      return;
    }
    
    const currentPrompt = getCurrentPrompt(config);
    const messageHistory = extractMessageHistory(config);
    console.log('User token:', mem2aiusertoken);
    console.log('History of memories:', messageHistory);
    console.log('Current prompt:', currentPrompt);
    
    if (!currentPrompt) {
      showNotification('Please enter a prompt first', 'warning');
      return;
    }
    
    try {
      isProcessing = true;
      button.classList.add('processing');
      if (runnerBar) runnerBar.classList.add('show');
      button.innerHTML = `
        <svg class="spinner" width="24" height="24" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" opacity="0.25"/>
          <path d="M12 2 A10 10 0 0 1 22 12" stroke="currentColor" stroke-width="2" fill="none"/>
        </svg>
        <span>Processing...</span>
      `;
      
      const refinedPrompt = await refinePrompt(currentPrompt, messageHistory, mem2aiusertoken);
      
      setPrompt(config, refinedPrompt);
      showNotification('Prompt refined successfully!', 'success');
      
    } catch (error) {
      // showNotification('Failed to refine prompt. Check console for details.', 'error');
      console.error('Refine error:', error);
    } finally {
      isProcessing = false;
      button.classList.remove('processing');
      if (runnerBar) runnerBar.classList.remove('show');
      button.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 20h9"></path>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
        </svg>
        <span>Refine</span>
      `;
    }
  });
  
  return button;
}

function ensureShadowContainer() {
  if (shadowContainer && shadowRoot) return shadowContainer;
  shadowContainer = document.createElement('div');
  shadowContainer.id = 'prompt-refiner-container';
  shadowContainer.style.position = 'fixed';
  shadowContainer.style.zIndex = '2147483646';
  shadowContainer.style.pointerEvents = 'none';
  shadowRoot = shadowContainer.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host{ all: initial }
    #wrap{ pointer-events: auto }
    button.processing .spinner{ animation: pr-spin 1s linear infinite }
    button.processing { opacity: 0.8; cursor: not-allowed !important; }
    button.processing:hover { transform: none !important; }
    @keyframes pr-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
    button#prompt-refiner-btn:hover:not(.processing) { opacity: 0.95; }
    .pr-animation { display:none; margin-bottom: 8px; width: 100%; max-width: 260px; height: 70px; border-radius: 10px; padding: 8px 12px; box-sizing:border-box; background: linear-gradient(120deg, #f6f7fb 0%, #edf2ff 100%); box-shadow: 0 4px 12px rgba(0,0,0,0.08); overflow:hidden; }
    .pr-animation.show { display:flex; align-items:flex-end; gap:8px; }
    .pr-animation .track { position:relative; flex:1; height:40px; border-radius: 20px; background: #dfe6ff; overflow:hidden; }
    .pr-animation .runner { position:absolute; left:-40px; bottom:6px; width:32px; height:32px; display:flex; align-items:center; justify-content:center; color:#0f172a; font-size:18px; animation: runner-move 2s linear infinite; }
    .pr-animation .hurdle { position:absolute; bottom:6px; width:14px; height:22px; background:#ffb347; border-radius:4px; animation: hurdle-move 2s linear infinite; }
    .pr-animation .hurdle.h2 { animation-delay: -0.8s; left:70%; }
    .pr-animation .hurdle.h3 { animation-delay: -1.4s; left:90%; }
    .pr-animation .road { position:absolute; bottom:0; left:0; right:0; height:6px; background: rgba(0,0,0,0.12); border-radius: 3px; }
    .pr-animation .cloud { width:14px; height:8px; background:white; border-radius: 10px; opacity:0.8; box-shadow: 8px 2px 0 0 white, 16px 4px 0 0 white; animation: cloud-move 6s linear infinite; }
    .pr-animation .cloud.c2 { animation-delay:-2s; }
    .pr-animation .cloud.c3 { animation-delay:-4s; }
    @keyframes runner-move { 0% { left:-40px; transform: translateY(0); } 20% { transform: translateY(-8px); } 40% { transform: translateY(0); } 60% { transform: translateY(-6px); } 100% { left: 105%; transform: translateY(0); } }
    @keyframes hurdle-move { 0% { transform: translateX(0); } 100% { transform: translateX(-110%); } }
    @keyframes cloud-move { 0% { transform: translateX(0); } 100% { transform: translateX(-120%); } }
  `;
  const wrap = document.createElement('div');
  wrap.id = 'wrap';

  shadowRoot.appendChild(style);
  shadowRoot.appendChild(wrap);
  document.body.appendChild(shadowContainer);
  return shadowContainer;
}

function mountButtonInShadow(config) {
  ensureShadowContainer();
  const wrap = shadowRoot.getElementById('wrap');
  wrap.innerHTML = '';
  runnerBar = createRunnerAnimation();
  wrap.appendChild(runnerBar);
  refineButton = createRefineButton(config);
  wrap.appendChild(refineButton);
}

function createRunnerAnimation() {
  const container = document.createElement('div');
  container.className = 'pr-animation';

  const clouds = document.createElement('div');
  clouds.style.display = 'flex';
  clouds.style.gap = '8px';
  clouds.style.marginBottom = '6px';
  ['c1','c2','c3'].forEach((c,i)=> {
    const cloud = document.createElement('div');
    cloud.className = `cloud ${c}`;
    cloud.style.animationDelay = `${-2*i}s`;
    clouds.appendChild(cloud);
  });

  const track = document.createElement('div');
  track.className = 'track';

  const runner = document.createElement('div');
  runner.className = 'runner';
  runner.textContent = '🏃';

  const hurdle1 = document.createElement('div');
  hurdle1.className = 'hurdle h1';

  const hurdle2 = document.createElement('div');
  hurdle2.className = 'hurdle h2';

  const hurdle3 = document.createElement('div');
  hurdle3.className = 'hurdle h3';

  const road = document.createElement('div');
  road.className = 'road';

  track.appendChild(runner);
  track.appendChild(hurdle1);
  track.appendChild(hurdle2);
  track.appendChild(hurdle3);
  track.appendChild(road);

  container.appendChild(clouds);
  container.appendChild(track);
  return container;
}

function positionButtonAtBottom() {
  if (!shadowContainer) return;
  // Position at bottom right, with some padding
  shadowContainer.style.bottom = '24px';
  shadowContainer.style.right = '24px';
  shadowContainer.style.left = 'auto';
  shadowContainer.style.top = 'auto';
  shadowContainer.style.transform = 'none';
}

// Show a login modal that guides the user to sign in
function showLoginModal() {
  if (document.getElementById('mem2ai-login-modal-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'mem2ai-login-modal-overlay';
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.zIndex = '2147483647';
  overlay.style.background = 'rgba(15, 23, 42, 0.55)';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.backdropFilter = 'blur(2px)';

  const modal = document.createElement('div');
  modal.style.background = 'linear-gradient(135deg, #ffffff 0%, #eef2ff 100%)';
  modal.style.borderRadius = '18px';
  modal.style.padding = '24px 28px';
  modal.style.maxWidth = '380px';
  modal.style.width = '90%';
  modal.style.boxShadow = '0 18px 45px rgba(15, 23, 42, 0.35)';
  modal.style.color = '#0f172a';
  modal.style.fontFamily = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  modal.style.boxSizing = 'border-box';

  const title = document.createElement('h2');
  title.textContent = 'You’re not signed in to Mem2AI';
  title.style.margin = '0 0 8px';
  title.style.fontSize = '18px';
  title.style.fontWeight = '700';

  const subtitle = document.createElement('p');
  subtitle.textContent = 'To refine prompts with your memories, please sign in to Mem2AI in a separate tab, then come back here and try again.';
  subtitle.style.margin = '0 0 18px';
  subtitle.style.fontSize = '14px';
  subtitle.style.lineHeight = '1.5';
  subtitle.style.color = '#334155';

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.justifyContent = 'flex-end';
  actions.style.gap = '10px';
  actions.style.marginTop = '4px';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Not now';
  cancelBtn.style.all = 'unset';
  cancelBtn.style.padding = '8px 12px';
  cancelBtn.style.borderRadius = '999px';
  cancelBtn.style.cursor = 'pointer';
  cancelBtn.style.fontSize = '13px';
  cancelBtn.style.color = '#64748b';
  cancelBtn.style.fontWeight = '500';
  cancelBtn.addEventListener('click', () => {
    document.body.removeChild(overlay);
  });

  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = 'Sign in now';
  confirmBtn.style.all = 'unset';
  confirmBtn.style.padding = '9px 16px';
  confirmBtn.style.borderRadius = '999px';
  confirmBtn.style.cursor = 'pointer';
  confirmBtn.style.fontSize = '13px';
  confirmBtn.style.fontWeight = '600';
  confirmBtn.style.color = '#ffffff';
  confirmBtn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
  confirmBtn.style.boxShadow = '0 10px 25px rgba(102, 126, 234, 0.45)';
  confirmBtn.addEventListener('mouseenter', () => {
    confirmBtn.style.transform = 'translateY(-1px)';
    confirmBtn.style.boxShadow = '0 14px 30px rgba(102, 126, 234, 0.55)';
  });
  confirmBtn.addEventListener('mouseleave', () => {
    confirmBtn.style.transform = 'translateY(0)';
    confirmBtn.style.boxShadow = '0 10px 25px rgba(102, 126, 234, 0.45)';
  });
  confirmBtn.addEventListener('click', () => {
    window.open(website_url, '_blank');
    document.body.removeChild(overlay);
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);

  modal.appendChild(title);
  modal.appendChild(subtitle);
  modal.appendChild(actions);

  overlay.appendChild(modal);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      document.body.removeChild(overlay);
    }
  });

  document.body.appendChild(overlay);
}

// Show notification to user
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `prompt-refiner-notification ${type}`;
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  setTimeout(() => notification.classList.add('show'), 10);
  
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Inject the button into the page
function injectButton(config) {
  // No need to check for send button anymore - we just need the page to be ready
  mountButtonInShadow(config);
  positionButtonAtBottom();

  // Clean up any existing observers
  if (positionObserver) {
    positionObserver.disconnect();
    positionObserver = null;
  }

  console.log('Prompt Refiner button injected successfully');
  return true;
}

// Initialize the extension
function init() {
  const config = getSiteConfig();
  
  if (!config) {
    console.log('Prompt Refiner: Unsupported site');
    return;
  }
  
  console.log(`Prompt Refiner: Initializing for ${config.name}`);
  
  // Inject button immediately - doesn't depend on send button anymore
  injectButton(config);
  
  // Ensure button stays at bottom on scroll/resize
  window.addEventListener('resize', positionButtonAtBottom, { passive: true });
  window.addEventListener('scroll', positionButtonAtBottom, { passive: true });
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
