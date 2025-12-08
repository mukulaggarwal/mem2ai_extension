let refineButton = null;
let isProcessing = false;
let shadowContainer = null;
let shadowRoot = null;
let positionObserver = null;
let runnerBar = null;
let syncTimeout = null;

// Configuration - Update this with your backend API endpoint
const API_CONFIG = {
  // endpoint: 'http://127.0.0.1:8000/v1/refine',
  endpoint: 'https://optimus.mem2ai.com/v1/refine',
  apiKey: 'YOUR_API_KEY' // Store this securely or get from chrome.storage
};
const MEM_SYNC_ENDPOINT = 'https://optimus.mem2ai.com/v1/memories/sync';

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
  } else if (hostname.includes('perplexity.ai')) {
    console.log('Site detected: Perplexity');
    return {
      name: 'Perplexity',
      textareaSelector: [
        '#ask-input',
        '#ask-input p span',
        '#ask-input p',
        '#ask-input [contenteditable="true"]',
        'textarea[placeholder*="Ask"]',
        'textarea[aria-label*="Ask"]',
        'textarea[aria-label*="Type"]',
        'textarea[data-testid*="chat-input"]',
        'div[contenteditable="true"][data-testid*="composer"]',
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"][data-testid*="search-input"]'
      ].join(', '),
      sendButtonSelector: 'button[type="submit"], button[data-testid*="send"], button[aria-label*="Send"]',
      messageSelector: '[data-testid*="message"], [data-testid*="chat-message"], article, [class*="prose"], [data-message-author-role]',
      inputContainerSelector: 'form, [role="search"], [role="form"], [data-testid*="composer"]'
    };
  } else if (hostname.includes('grok') || hostname.includes('x.ai')) {
    console.log('Site detected: Grok');
    return {
      name: 'Grok',
      textareaSelector: [
        'textarea[aria-label*=\"Message\"]',
        'textarea[placeholder*=\"Message\"]',
        'textarea[placeholder*=\"Ask\"]',
        'div[contenteditable=\"true\"][role=\"textbox\"]',
        'div[contenteditable=\"true\"][aria-label*=\"Message\"]',
        'div[contenteditable=\"true\"][data-testid*=\"prompt\"], div[contenteditable=\"true\"][data-testid*=\"composer\"]',
        'div[contenteditable=\"true\"][class*=\"ProseMirror\"]',
        // XPath hint converted to a broader selector near the form container
        'form div div div:nth-of-type(2) div:nth-of-type(1) div div[contenteditable=\"true\"]'
      ].join(', '),
      sendButtonSelector: 'button[aria-label*="Send"], button[type="submit"], button[data-testid*="send"], form button',
      messageSelector: '[data-message-author-role], article, [role="listitem"], [class*="message"], [data-testid*="message"]',
      inputContainerSelector: 'form, [role="form"]'
    };
  }
  
  return null;
}

// Extract message history from the page
function extractMessageHistory(config) {
  const messages = [];
  
  // Site-specific extraction
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
  } else if (config.name === 'Perplexity') {
    console.log('Extracting Perplexity message history...');
    
    // Try multiple strategies to find Perplexity messages
    // Strategy 1: Look for message containers with data attributes
    let messageElements = document.querySelectorAll('[data-testid*="message"], [data-testid*="chat-message"], [data-message-author-role]');
    
    // Strategy 2: Look for article elements (Perplexity uses these for messages)
    if (messageElements.length === 0) {
      messageElements = document.querySelectorAll('article, [role="article"]');
    }
    
    // Strategy 3: Look for message-like divs in the main chat area
    if (messageElements.length === 0) {
      const main = document.querySelector('main');
      if (main) {
        messageElements = main.querySelectorAll('div[class*="message"], div[class*="Message"], div[class*="chat"]');
      }
    }
    
    // Strategy 4: Look for any divs with text that might be messages
    if (messageElements.length === 0) {
      const main = document.querySelector('main');
      if (main) {
        // Find divs that contain substantial text (likely messages)
        const allDivs = main.querySelectorAll('div');
        messageElements = Array.from(allDivs).filter(div => {
          const text = div.innerText.trim();
          return text.length > 20 && !div.querySelector('div'); // Has text and is a leaf node
        });
      }
    }
    
    console.log('Found', messageElements.length, 'potential message elements');
    
    messageElements.forEach((el, idx) => {
      let role = null;
      
      // Try to determine role from attributes
      role = el.getAttribute('data-message-author-role');
      
      if (!role) {
        const testId = el.getAttribute('data-testid') || '';
        if (/user|human|person/i.test(testId)) role = 'user';
        else if (/assistant|bot|ai|model|perplexity/i.test(testId)) role = 'assistant';
      }
      
      if (!role) {
        const cls = el.className || '';
        const classStr = cls.toString();
        if (/user|human|person|question|prompt/i.test(classStr)) role = 'user';
        else if (/assistant|ai|response|answer|perplexity|model/i.test(classStr)) role = 'assistant';
      }
      
      // Check parent elements for role indicators
      if (!role) {
        const parent = el.closest('[data-message-author-role], [data-testid*="user"], [data-testid*="assistant"]');
        if (parent) {
          const parentRole = parent.getAttribute('data-message-author-role');
          const parentTestId = parent.getAttribute('data-testid') || '';
          if (parentRole) role = parentRole;
          else if (/user|human/i.test(parentTestId)) role = 'user';
          else if (/assistant|bot|ai/i.test(parentTestId)) role = 'assistant';
        }
      }
      
      // Check for user input indicators (input boxes, textareas in the message)
      if (!role && el.querySelector('textarea, input[type="text"], [contenteditable="true"]')) {
        role = 'user';
      }
      
      // Check for assistant indicators (citations, sources, etc.)
      if (!role && (el.querySelector('[class*="citation"], [class*="source"], [class*="reference"]') || 
                    el.querySelector('a[href*="perplexity"], a[href*="source"]'))) {
        role = 'assistant';
      }
      
      const text = el.innerText.trim();
      
      // Skip if text is too short or looks like UI elements
      if (text.length < 3) return;
      if (/^(send|ask|search|submit|clear|new chat)$/i.test(text)) return;
      
      // If we still don't have a role, try alternating based on position
      // (user messages typically come first, then assistant)
      if (!role && messages.length > 0) {
        const lastRole = messages[messages.length - 1].role;
        role = lastRole === 'user' ? 'assistant' : 'user';
      } else if (!role) {
        // First message is usually user
        role = 'user';
      }
      
      if (text && role) {
        console.log(`Found ${role} message:`, text.substring(0, 50) + '...');
          messages.push({ role, content: text });
        }
      });
    
    console.log('Extracted', messages.length, 'messages from Perplexity');
  } else if (config.name === 'Grok') {
    const messageElements = document.querySelectorAll(config.messageSelector);
    messageElements.forEach(el => {
      let role = el.getAttribute('data-message-author-role');
      if (!role) {
        const cls = el.className || '';
        if (/user/i.test(cls)) role = 'user';
        else if (/assistant|bot|ai/i.test(cls)) role = 'assistant';
      }
      const text = el.innerText.trim();
      if (text && role) messages.push({ role, content: text });
    });
    if (messages.length === 0) {
      const altEls = document.querySelectorAll('main [data-testid*="message"], main article, main [role="listitem"], [data-message-author-role]');
      altEls.forEach((el, idx) => {
        const text = el.innerText.trim();
        if (text) {
          let role = el.getAttribute('data-message-author-role');
          if (!role) role = idx % 2 === 0 ? 'user' : 'assistant';
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

// Helpers to throttle background sync per site
function getLastSyncTime(hostname) {
  const stored = localStorage.getItem(`mem2ai_last_sync_${hostname}`);
  const parsed = parseInt(stored, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function setLastSyncTime(hostname, timestamp) {
  try {
    localStorage.setItem(`mem2ai_last_sync_${hostname}`, String(timestamp));
  } catch (e) {
    console.warn('Unable to store last sync time:', e);
  }
}

function getPlatformSlug(config) {
  const name = (config?.name || '').toLowerCase();
  if (name.includes('claude')) return 'claude';
  if (name.includes('gemini')) return 'gemini';
  if (name.includes('perplexity')) return 'perplexity';
  // Default to openai for ChatGPT, Grok, and any other OpenAI-style chat UIs
  return 'openai';
}

async function attemptHistorySync(config) {
  const hostname = window.location.hostname;
  const now = Date.now();
  const lastSync = getLastSyncTime(hostname);
  if (now - lastSync < 5 * 60 * 1000) return; // within 5 minutes, skip

  const mem2aiusertoken = await getUserTokenWithSync();
  if (!mem2aiusertoken) return;

  const history = extractMessageHistory(config);
  if (!history || history.length === 0) return;

  try {
    const platform = getPlatformSlug(config);
    const resp = await fetch(MEM_SYNC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'mem2aiusertoken': mem2aiusertoken
      },
      body: JSON.stringify({
        platform,
        history
      })
    });
    if (!resp.ok) throw new Error(`Sync failed: ${resp.status}`);
    setLastSyncTime(hostname, now);
    console.log('Mem2AI sync success');
  } catch (err) {
    console.error('Mem2AI sync error:', err);
  }
}

function scheduleHistorySync(config) {
  if (syncTimeout) return;
  syncTimeout = setTimeout(() => {
    attemptHistorySync(config);
    syncTimeout = null;
  }, 30000); // 30 seconds on page
}

// Simulate typing to set text (fallback method)
function simulateTyping(element, text) {
  console.log('Simulating typing for element:', element.tagName, element.id);
  
  // Clear existing content thoroughly - remove all children
  if (element.contentEditable === 'true' || element.tagName === 'SPAN' || element.tagName === 'P') {
    // Remove all child nodes
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
    element.textContent = '';
    element.innerText = '';
    element.innerHTML = '';
    
    // Also clear parent if it's #ask-input structure
    const askInput = document.querySelector('#ask-input');
    if (askInput && element !== askInput) {
      const p = askInput.querySelector('p');
      if (p && element !== p) {
        while (p.firstChild) {
          p.removeChild(p.firstChild);
        }
        p.textContent = '';
      }
    }
  } else {
    element.value = '';
  }
  
  // Focus the element
  element.focus();
  
  // Type character by character with small delays
  let index = 0;
  const typeChar = () => {
    if (index < text.length) {
      const char = text[index];
      
      // Dispatch keydown
      element.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: char,
        code: char === ' ' ? 'Space' : `Key${char.toUpperCase()}`,
        charCode: char.charCodeAt(0),
        keyCode: char.charCodeAt(0)
      }));
      
      // Insert character
      if (element.contentEditable === 'true' || element.tagName === 'SPAN' || element.tagName === 'P') {
        const currentText = element.textContent || '';
        element.textContent = currentText + char;
        element.innerText = currentText + char;
      } else {
        element.value += char;
      }
      
      // Dispatch input event
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: char
      }));
      
      // Dispatch keyup
      element.dispatchEvent(new KeyboardEvent('keyup', {
        bubbles: true,
        cancelable: true,
        key: char,
        code: char === ' ' ? 'Space' : `Key${char.toUpperCase()}`,
        charCode: char.charCodeAt(0),
        keyCode: char.charCodeAt(0)
      }));
      
      index++;
      setTimeout(typeChar, 10); // Small delay between characters
    } else {
      // Final input event
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      
      // Also trigger on parent if it's #ask-input
      const askInput = document.querySelector('#ask-input');
      if (askInput && element !== askInput) {
        askInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      
      console.log('Simulated typing complete. Final text:', element.textContent || element.value);
    }
  };
  
  typeChar();
}

// Get current prompt text
function getCurrentPrompt(config) {
  // Try multiple selectors in order
  let textarea = null;
  const selectors = config.textareaSelector.split(',').map(s => s.trim()).filter(Boolean);
  for (const selector of selectors) {
    textarea = document.querySelector(selector);
    if (textarea) break;
  }

  // Site-specific fallbacks
  if (!textarea && config.name === 'Perplexity') {
    // Try the specific Perplexity structure: #ask-input > p > span
    const askInput = document.querySelector('#ask-input');
    if (askInput) {
      // Try to find the actual editable element (span or p)
      textarea = askInput.querySelector('p span');
      if (!textarea) {
        textarea = askInput.querySelector('p');
      }
      if (!textarea) {
        textarea = askInput.querySelector('[contenteditable="true"]');
      }
      if (!textarea) {
        textarea = askInput; // Fallback to the container itself
      }
    }
    if (!textarea) {
      // Try multiple Perplexity-specific selectors
      textarea = document.querySelector('textarea[placeholder*="Ask"], textarea[aria-label*="Ask"], textarea[data-testid*="chat-input"]');
    }
    if (!textarea) {
      textarea = document.querySelector('div[contenteditable="true"][data-testid*="composer"], div[contenteditable="true"][role="textbox"]');
    }
    if (!textarea) {
      // Try finding the input in the form
      const form = document.querySelector('form');
      if (form) {
        textarea = form.querySelector('[contenteditable="true"], textarea, #ask-input');
      }
    }
  }
  if (!textarea && config.name === 'Grok') {
    textarea = document.querySelector('form [contenteditable="true"], [data-testid*="prompt"] [contenteditable="true"], [class*="ProseMirror"][contenteditable="true"]');
  }
  
  if (!textarea) {
    console.warn('Could not find textarea for', config.name);
    return '';
  }
  
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
  
  const selectors = config.textareaSelector.split(',').map(s => s.trim()).filter(Boolean);
  for (const selector of selectors) {
    textarea = document.querySelector(selector);
    if (textarea) break;
  }

  // Site-specific fallbacks
  if (!textarea && config.name === 'Perplexity') {
    // Try the specific Perplexity structure: #ask-input > p > span
    const askInput = document.querySelector('#ask-input');
    if (askInput) {
      // Try to find the actual editable element (span or p)
      textarea = askInput.querySelector('p span');
      if (!textarea) {
        textarea = askInput.querySelector('p');
      }
      if (!textarea) {
        textarea = askInput.querySelector('[contenteditable="true"]');
      }
      if (!textarea) {
        textarea = askInput; // Fallback to the container itself
      }
    }
    if (!textarea) {
      // Try multiple Perplexity-specific selectors
      textarea = document.querySelector('textarea[placeholder*="Ask"], textarea[aria-label*="Ask"], textarea[data-testid*="chat-input"]');
    }
    if (!textarea) {
      textarea = document.querySelector('div[contenteditable="true"][data-testid*="composer"], div[contenteditable="true"][role="textbox"]');
    }
    if (!textarea) {
      // Try finding the input in the form
      const form = document.querySelector('form');
      if (form) {
        textarea = form.querySelector('[contenteditable="true"], textarea, #ask-input');
      }
    }
  }
  if (!textarea && config.name === 'Grok') {
    textarea = document.querySelector('form [contenteditable="true"], [data-testid*="prompt"] [contenteditable="true"], [class*="ProseMirror"][contenteditable="true"]');
  }
  
  if (!textarea) {
    console.error('Could not find textarea for', config.name);
    return;
  }
  
  console.log('Found textarea for', config.name, textarea, 'Tag:', textarea.tagName, 'ID:', textarea.id);
  
  // Handle contenteditable divs (like Claude, Gemini, Perplexity, Grok)
  if (textarea.contentEditable === 'true' || textarea.getAttribute('contenteditable') === 'true' || config.name === 'Perplexity') {
    // Perplexity-specific handling
    if (config.name === 'Perplexity') {
      console.log('Setting prompt for Perplexity:', text);
      console.log('Target element:', textarea, 'Tag:', textarea.tagName, 'ID:', textarea.id);
      
      // For Perplexity's #ask-input > p > span structure, we need to target the right element
      // The span is likely the actual text container
      let targetElement = textarea;
      const askInput = document.querySelector('#ask-input');
      if (askInput) {
        const span = askInput.querySelector('p span');
        const p = askInput.querySelector('p');
        // Prefer span, then p, then the container
        if (span) {
          targetElement = span;
          console.log('Using span element for text input');
        } else if (p) {
          targetElement = p;
          console.log('Using p element for text input');
        } else {
          targetElement = askInput;
          console.log('Using #ask-input container for text input');
        }
      }
      
      // Focus the target element
      targetElement.focus();
      
      // Wait a bit for focus to settle
      setTimeout(() => {
        // Clear existing content more thoroughly - need to clear all nested elements
        // For Perplexity's structure, we need to clear the entire #ask-input container
        if (askInput) {
          // Clear the entire container structure
          const p = askInput.querySelector('p');
          if (p) {
            p.innerHTML = '';
            p.textContent = '';
            p.innerText = '';
          }
          const span = askInput.querySelector('p span');
          if (span) {
            span.innerHTML = '';
            span.textContent = '';
            span.innerText = '';
          }
        }
        
        // Clear the target element itself
        targetElement.innerHTML = '';
        targetElement.textContent = '';
        targetElement.innerText = '';
        
        // Also clear any text nodes that might be direct children
        while (targetElement.firstChild) {
          targetElement.removeChild(targetElement.firstChild);
        }
        
        // For span/p elements, we need to set the text directly
        // Method 1: Direct textContent (this replaces, not appends)
        targetElement.textContent = text;
        
        // Verify we cleared everything - check if there's still old text
        const currentTextAfterClear = targetElement.textContent || '';
        if (currentTextAfterClear && currentTextAfterClear !== text) {
          console.log('Still found old text after clear, clearing again:', currentTextAfterClear);
          // Force clear again
          targetElement.innerHTML = '';
          targetElement.textContent = '';
          targetElement.innerText = '';
          while (targetElement.firstChild) {
            targetElement.removeChild(targetElement.firstChild);
          }
          // Also clear parent elements
          if (askInput) {
            const p = askInput.querySelector('p');
            if (p) {
              p.innerHTML = '';
              p.textContent = '';
              while (p.firstChild) {
                p.removeChild(p.firstChild);
              }
            }
            const span = askInput.querySelector('p span');
            if (span) {
              span.innerHTML = '';
              span.textContent = '';
              while (span.firstChild) {
                span.removeChild(span.firstChild);
              }
            }
          }
        }
        
        // Now set the new text (replacing, not appending)
        targetElement.textContent = text;
        
        // Verify it was set correctly
        if (targetElement.textContent !== text) {
          console.log('textContent setting failed, trying innerText');
          targetElement.innerText = text;
        }
        
        // For span/p elements, ensure we have a clean text node
        if (targetElement.tagName === 'SPAN' || targetElement.tagName === 'P') {
          // Remove all children and create a fresh text node
          while (targetElement.firstChild) {
            targetElement.removeChild(targetElement.firstChild);
          }
          const textNode = document.createTextNode(text);
          targetElement.appendChild(textNode);
        }
        
        // Also update the parent container if needed
        if (askInput && targetElement !== askInput) {
          // Make sure the parent knows about the change
          askInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        
        // Trigger React's synthetic events
        // Perplexity uses React, so we need to trigger React's event system
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'textContent')?.set;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(targetElement, text);
        }
        
        // Trigger a comprehensive set of events on the target element
        const inputEvent = new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text,
          isComposing: false
        });
        targetElement.dispatchEvent(inputEvent);
        
        // Also trigger on parent if it exists
        if (askInput && targetElement !== askInput) {
          askInput.dispatchEvent(inputEvent);
        }
        
        // Also trigger standard events
        targetElement.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        targetElement.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        
        // Trigger composition events (some React components listen to these)
        targetElement.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        targetElement.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: text }));
        targetElement.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: text }));
        
        // Try to find and trigger React's internal handlers on both target and parent
        [targetElement, askInput].forEach(el => {
          if (!el) return;
          const reactKey = Object.keys(el).find(key => key.startsWith('__reactInternalInstance') || key.startsWith('__reactFiber'));
          if (reactKey) {
            const reactInstance = el[reactKey];
            if (reactInstance && reactInstance.memoizedProps && reactInstance.memoizedProps.onChange) {
              reactInstance.memoizedProps.onChange({ target: { value: text, textContent: text } });
            }
          }
          
          // Try to find React event handlers on the element
          const allKeys = Object.keys(el);
          allKeys.forEach(key => {
            if (key.startsWith('__reactEventHandlers') || key.startsWith('__reactProps')) {
              const handlers = el[key];
              if (handlers && handlers.onChange) {
                handlers.onChange({ target: { value: text, textContent: text } });
              }
              if (handlers && handlers.onInput) {
                handlers.onInput({ target: { value: text, textContent: text } });
              }
            }
          });
        });
        
        // Additional delayed events to ensure state updates
        setTimeout(() => {
          targetElement.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: text
          }));
          
          // Try setting again after a delay
          if (targetElement.textContent !== text) {
            targetElement.textContent = text;
            targetElement.dispatchEvent(new Event('input', { bubbles: true }));
          }
          
          console.log('After delay, textarea content:', targetElement.textContent);
        }, 100);
        
        setTimeout(() => {
          // Final check and update
          if (targetElement.textContent !== text) {
            // If direct setting didn't work, try simulating typing
            console.log('Direct setting failed, trying simulated typing...');
            simulateTyping(targetElement, text);
          } else {
            console.log('Final textarea content:', targetElement.textContent);
          }
        }, 200);
      }, 10);
    } else {
      // Standard contenteditable handling for other sites
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
    // Some editors (e.g., Perplexity/Grok) respond better to InputEvent
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    }
  } else {
    // Handle regular textareas (like ChatGPT, or Perplexity textarea)
    if (config.name === 'Perplexity') {
      console.log('Setting prompt for Perplexity textarea:', text);
      
      // For Perplexity textarea, we need to trigger React events
      textarea.value = text;
      
      // Trigger React's onChange
      const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (nativeValueSetter) {
        nativeValueSetter.call(textarea, text);
      }
      
      // Trigger comprehensive events
      textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
      
      // Try to find and trigger React handlers
      const reactKey = Object.keys(textarea).find(key => key.startsWith('__reactInternalInstance') || key.startsWith('__reactFiber'));
      if (reactKey) {
        const reactInstance = textarea[reactKey];
        if (reactInstance && reactInstance.memoizedProps && reactInstance.memoizedProps.onChange) {
          reactInstance.memoizedProps.onChange({ target: { value: text } });
        }
      }
      
      // Additional delayed update
      setTimeout(() => {
        if (textarea.value !== text) {
          // If direct setting didn't work, try simulating typing
          console.log('Direct setting failed, trying simulated typing...');
          simulateTyping(textarea, text);
        } else {
          console.log('Final textarea value:', textarea.value);
        }
      }, 100);
    } else {
      // Standard textarea handling
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    }
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
async function refinePrompt(currentPrompt, messageHistory, mem2aiusertoken, config) {
  try {
    const response = await fetch(API_CONFIG.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'mem2aiusertoken': mem2aiusertoken
      },
      body: JSON.stringify({
        current_prompt: currentPrompt,
        history: messageHistory,
        platform: getPlatformSlug(config)
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
      
      const refinedPrompt = await refinePrompt(currentPrompt, messageHistory, mem2aiusertoken, config);
      
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
  // Schedule background history sync after user stays on page
  scheduleHistorySync(config);
  
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
