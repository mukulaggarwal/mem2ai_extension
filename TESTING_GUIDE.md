# Testing OAuth Locally - Step by Step Guide

## Prerequisites

1. **Google Cloud OAuth Setup** (if not done already):
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create/select a project
   - Enable "Google+ API" or "Google Identity API"
   - Create OAuth 2.0 credentials (Chrome Extension type)
   - Copy your Client ID
   - Update `manifest.json` with your Client ID

2. **Get Your Extension ID**:
   - After loading the extension, go to `chrome://extensions/`
   - Find your extension and copy the ID (looks like: `abcdefghijklmnopqrstuvwxyz123456`)
   - Add this Extension ID to your Google Cloud OAuth credentials

## Testing Steps

### Step 1: Load the Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `mem2ai_extension` folder
5. The extension should appear in your extensions list

### Step 2: Open the Popup

**Important**: The popup does NOT open automatically. You need to:

1. Click the extension icon in the Chrome toolbar (puzzle piece icon)
2. The popup should open showing either:
   - **Login screen** (if not authenticated) - with "Sign in with Google" button
   - **Settings screen** (if already authenticated) - with your email and settings

### Step 3: Test OAuth Login

1. If you see the login screen, click "Sign in with Google"
2. A Google sign-in window should open
3. Select your Google account
4. Grant permissions (email and profile)
5. The popup should automatically switch to the settings screen
6. Your email should be displayed in the top right

### Step 4: Verify Token Storage

1. Open Chrome DevTools (F12 or right-click → Inspect)
2. Go to the "Application" tab (or "Storage" in older Chrome)
3. In the left sidebar, expand "Local Storage"
4. Click on `chrome-extension://[YOUR_EXTENSION_ID]`
5. You should see:
   - `googleAuthToken`: Your OAuth token
   - `googleUserInfo`: JSON with your user info

Alternatively, check Chrome Storage:
1. In DevTools, go to "Application" tab
2. Expand "Storage" → "Extension Storage"
3. Click on your extension
4. You should see the stored token and user info

### Step 5: Test Logout

1. In the popup, click the "Logout" button
2. The popup should switch back to the login screen
3. Verify that tokens are cleared from storage

## Troubleshooting

### Popup doesn't open when clicking extension icon

- Check the browser console for errors (F12)
- Verify `popup.html` exists and is correctly referenced in `manifest.json`
- Make sure the extension is enabled (not grayed out)

### "Sign in with Google" button doesn't work

- Check the browser console for errors
- Verify your `client_id` in `manifest.json` is correct
- Make sure your Extension ID matches the one in Google Cloud Console
- Check that the OAuth credentials are set to "Chrome Extension" type

### OAuth window doesn't open

- Check browser console for errors
- Verify `identity` permission is in `manifest.json`
- Make sure `oauth2` section is properly configured in `manifest.json`
- Check that your Extension ID is added to the OAuth credentials in Google Cloud

### "Invalid client" error

- Your Extension ID in Google Cloud Console doesn't match your actual extension ID
- Get your current Extension ID from `chrome://extensions/`
- Update the OAuth credentials in Google Cloud Console with the correct Extension ID
- Reload the extension

### Token received but user info fetch fails

- Check that `https://www.googleapis.com/*` is in `host_permissions` in `manifest.json`
- Verify the token is valid (check browser console)
- Check network tab in DevTools to see the API request/response

## Debugging Tips

1. **Open Popup DevTools**:
   - Right-click inside the popup → "Inspect"
   - Or: Go to `chrome://extensions/` → Find your extension → Click "Inspect views: popup.html"

2. **Check Background Service Worker**:
   - Go to `chrome://extensions/`
   - Find your extension
   - Click "Inspect views: background page" or "service worker"

3. **View Console Logs**:
   - All `console.log()` statements will appear in the respective DevTools console
   - Popup logs → Popup DevTools console
   - Background logs → Background service worker console

4. **Check Storage**:
   - Use DevTools → Application → Storage
   - Or use `chrome.storage.local.get(null, console.log)` in console

## Common Issues

### Extension ID Changes on Reload

- In development, Extension ID can change when you reload
- Solution: Use a fixed Extension ID by adding a `key` field to `manifest.json` (requires generating a key)

### OAuth Redirect Issues

- Chrome Identity API handles redirects automatically
- No need to configure redirect URIs manually for Chrome extensions

### Scopes Not Working

- Verify scopes in `manifest.json` `oauth2.scopes` array
- Check that required APIs are enabled in Google Cloud Console

## Next Steps After Testing

Once OAuth is working:
1. Test the full flow: Login → Use extension → Logout
2. Test token persistence (close/reopen browser)
3. Test on different Google accounts
4. Prepare for production deployment

