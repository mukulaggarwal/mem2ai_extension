let refineButton = null;
let isProcessing = false;
let shadowContainer = null;
let shadowRoot = null;
let positionObserver = null;

// Configuration - Update this with your backend API endpoint
const API_CONFIG = {
  endpoint: 'https://your-backend-api.com/refine-prompt',
  apiKey: 'YOUR_API_KEY' // Store this securely or get from chrome.storage
};

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
async function refinePrompt(currentPrompt, messageHistory) {
  try {
    const response = await fetch(API_CONFIG.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_CONFIG.apiKey}`
      },
      body: JSON.stringify({
        current_prompt: currentPrompt,
        message_history: messageHistory
      })
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.refined_prompt || data.prompt || currentPrompt;
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
    
    const currentPrompt = getCurrentPrompt(config);
    console.log('Current prompt:', currentPrompt);
    
    if (!currentPrompt) {
      showNotification('Please enter a prompt first', 'warning');
      return;
    }
    
    try {
      isProcessing = true;
      button.classList.add('processing');
      button.innerHTML = `
        <svg class="spinner" width="24" height="24" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" opacity="0.25"/>
          <path d="M12 2 A10 10 0 0 1 22 12" stroke="currentColor" stroke-width="2" fill="none"/>
        </svg>
        <span>Processing...</span>
      `;
      
      const messageHistory = extractMessageHistory(config);
      console.log('Message history:', messageHistory);
      const refinedPrompt = await refinePrompt(currentPrompt, messageHistory);
      
      setPrompt(config, refinedPrompt);
      showNotification('Prompt refined successfully!', 'success');
      
    } catch (error) {
      showNotification('Failed to refine prompt. Check console for details.', 'error');
      console.error('Refine error:', error);
    } finally {
      isProcessing = false;
      button.classList.remove('processing');
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
  refineButton = createRefineButton(config);
  wrap.appendChild(refineButton);
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