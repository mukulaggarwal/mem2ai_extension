document.addEventListener('DOMContentLoaded', () => {
    console.log('Popup DOM loaded');
    const loginScreen = document.getElementById('loginScreen');
    const settingsScreen = document.getElementById('settingsScreen');
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const loginStatus = document.getElementById('loginStatus');
    const userEmail = document.getElementById('userEmail');
    const apiEndpointInput = document.getElementById('apiEndpoint');
    const apiKeyInput = document.getElementById('apiKey');
    const saveBtn = document.getElementById('saveBtn');
    const status = document.getElementById('status');
    
    // Verify elements exist
    if (!loginScreen || !settingsScreen) {
        console.error('Required elements not found!', { loginScreen, settingsScreen });
        return;
    }
    
    // Check authentication status on load
    checkAuthAndShowScreen();
    
    // Login button handler
    loginBtn.addEventListener('click', async () => {
        await handleGoogleLogin();
    });
    
    // Logout button handler
    logoutBtn.addEventListener('click', async () => {
        await handleLogout();
    });
    
    // Save settings handler
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
    
    // Check authentication status and show appropriate screen
    async function checkAuthAndShowScreen() {
        try {
            console.log('Checking authentication status...');
            // Check if user is authenticated
            chrome.storage.local.get(['googleAuthToken', 'googleUserInfo'], (result) => {
                console.log('Storage result:', result);
                const isAuthenticated = !!(result.googleAuthToken && result.googleUserInfo);
                console.log('Is authenticated:', isAuthenticated);
                
                if (isAuthenticated) {
                    // Show settings screen
                    console.log('Showing settings screen');
                    showSettingsScreen(result.googleUserInfo);
                    loadSettings();
                } else {
                    // Show login screen
                    console.log('Showing login screen');
                    showLoginScreen();
                }
            });
        } catch (error) {
            console.error('Error checking auth status:', error);
            showLoginScreen();
        }
    }
    
    // Show login screen
    function showLoginScreen() {
        console.log('Displaying login screen');
        if (loginScreen) {
            loginScreen.style.display = 'block';
        }
        if (settingsScreen) {
            settingsScreen.style.display = 'none';
        }
        if (loginStatus) {
            loginStatus.textContent = '';
        }
    }
    
    // Show settings screen
    function showSettingsScreen(userInfo) {
        console.log('Displaying settings screen', userInfo);
        if (loginScreen) {
            loginScreen.style.display = 'none';
        }
        if (settingsScreen) {
            settingsScreen.style.display = 'block';
        }
        
        if (userInfo && userEmail) {
            if (userInfo.email) {
                userEmail.textContent = userInfo.email;
            } else if (userInfo.name) {
                userEmail.textContent = userInfo.name;
            } else {
                userEmail.textContent = 'Signed in';
            }
        }
    }
    
    // Handle Google login
    async function handleGoogleLogin() {
        console.log('Starting Google login...');
        if (loginBtn) {
            loginBtn.disabled = true;
            loginBtn.textContent = 'Signing in...';
        }
        if (loginStatus) {
            loginStatus.textContent = '';
        }
        
        try {
            // Use Chrome Identity API to get Google OAuth token
            // This will use the client_id and scopes defined in manifest.json oauth2 section
            console.log('Calling chrome.identity.getAuthToken...');
            chrome.identity.getAuthToken(
                { 
                    interactive: true,
                    // Scopes are automatically taken from manifest.json oauth2.scopes
                    // You can override here if needed, but it's better to define in manifest
                },
                async (token) => {
                    if (chrome.runtime.lastError) {
                        console.error('Auth error:', chrome.runtime.lastError);
                        if (loginStatus) {
                            loginStatus.textContent = 'Error: ' + chrome.runtime.lastError.message;
                            loginStatus.style.color = '#d32f2f';
                        }
                        if (loginBtn) {
                            loginBtn.disabled = false;
                            loginBtn.innerHTML = `
                            <svg width="18" height="18" viewBox="0 0 24 24">
                                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                            </svg>
                            Sign in with Google
                        `;
                        return;
                    }
                    
                    console.log('Got OAuth token:', token ? 'Token received' : 'No token');
                    
                    // Get user info from Google API
                    try {
                        console.log('Fetching user info from Google API...');
                        const userInfo = await getUserInfo(token);
                        console.log('User info received:', userInfo);
                        
                        // Store token and user info in chrome.storage.local (extension's localStorage equivalent)
                        chrome.storage.local.set({
                            googleAuthToken: token,
                            googleUserInfo: userInfo,
                            authTimestamp: Date.now()
                        }, () => {
                            // Also store in actual localStorage for compatibility
                            try {
                                localStorage.setItem('googleAuthToken', token);
                                localStorage.setItem('googleUserInfo', JSON.stringify(userInfo));
                            } catch (e) {
                                console.warn('Could not write to localStorage:', e);
                            }
                            
                            // Show success and switch to settings screen
                            if (loginStatus) {
                                loginStatus.textContent = '✓ Signed in successfully!';
                                loginStatus.style.color = '#2e7d32';
                            }
                            
                            setTimeout(() => {
                                showSettingsScreen(userInfo);
                                loadSettings();
                            }, 500);
                        });
                    } catch (error) {
                        console.error('Error getting user info:', error);
                        if (loginStatus) {
                            loginStatus.textContent = 'Error getting user information';
                            loginStatus.style.color = '#d32f2f';
                        }
                        if (loginBtn) {
                            loginBtn.disabled = false;
                            loginBtn.innerHTML = `
                            <svg width="18" height="18" viewBox="0 0 24 24">
                                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                            </svg>
                            Sign in with Google
                        `;
                        }
                    }
                }
            );
        } catch (error) {
            console.error('Login error:', error);
            if (loginStatus) {
                loginStatus.textContent = 'Error: ' + error.message;
                loginStatus.style.color = '#d32f2f';
            }
            if (loginBtn) {
                loginBtn.disabled = false;
                loginBtn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Sign in with Google
            `;
            }
        }
    }
    
    // Get user info from Google API
    async function getUserInfo(token) {
        return new Promise((resolve, reject) => {
            fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error('Failed to get user info');
                }
                return response.json();
            })
            .then(data => {
                resolve({
                    email: data.email,
                    name: data.name,
                    picture: data.picture,
                    id: data.id
                });
            })
            .catch(error => {
                reject(error);
            });
        });
    }
    
    // Handle logout
    async function handleLogout() {
        try {
            // Get the token to revoke it
            chrome.storage.local.get(['googleAuthToken'], (result) => {
                if (result.googleAuthToken) {
                    // Revoke the token
                    chrome.identity.removeCachedAuthToken(
                        { token: result.googleAuthToken },
                        () => {
                            // Clear storage
                            chrome.storage.local.remove(['googleAuthToken', 'googleUserInfo', 'authTimestamp'], () => {
                                // Also clear localStorage
                                try {
                                    localStorage.removeItem('googleAuthToken');
                                    localStorage.removeItem('googleUserInfo');
                                } catch (e) {
                                    console.warn('Could not clear localStorage:', e);
                                }
                                
                                // Show login screen
                                showLoginScreen();
                            });
                        }
                    );
                } else {
                    // Just clear storage if no token
                    chrome.storage.local.remove(['googleAuthToken', 'googleUserInfo', 'authTimestamp'], () => {
                        try {
                            localStorage.removeItem('googleAuthToken');
                            localStorage.removeItem('googleUserInfo');
                        } catch (e) {
                            console.warn('Could not clear localStorage:', e);
                        }
                        showLoginScreen();
                    });
                }
            });
        } catch (error) {
            console.error('Logout error:', error);
            // Still show login screen even if there's an error
            showLoginScreen();
        }
    }
    
    // Load settings
    function loadSettings() {
        chrome.storage.sync.get(['apiEndpoint', 'apiKey'], (result) => {
            if (result.apiEndpoint) {
                apiEndpointInput.value = result.apiEndpoint;
            }
            if (result.apiKey) {
                apiKeyInput.value = result.apiKey;
            }
        });
    }
});
