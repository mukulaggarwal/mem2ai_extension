# Google OAuth 2.0 Setup Instructions

## Getting Your Google Cloud Client ID

To use Google OAuth 2.0 authentication, you need to:

1. **Create a Google Cloud Project**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select an existing one

2. **Enable Google+ API**
   - Navigate to "APIs & Services" > "Library"
   - Search for "Google+ API" or "Google Identity API"
   - Click "Enable"

3. **Create OAuth 2.0 Credentials**
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Choose "Chrome Extension" as the application type
   - Enter your extension ID (you can find it in `chrome://extensions/` after loading the extension in developer mode)
   - **Note**: For development, your extension ID may change when you reload. For production, use your published extension ID from Chrome Web Store
   - Click "Create"
   - Copy the **Client ID** (it will look like: `xxxxx.apps.googleusercontent.com`)

4. **Update manifest.json**
   - Open `manifest.json`
   - Replace `YOUR_GOOGLE_CLOUD_CLIENT_ID.apps.googleusercontent.com` with your actual Client ID
   - Save the file

5. **Reload the Extension**
   - Go to `chrome://extensions/`
   - Click the reload icon on your extension
   - The OAuth flow will now use your custom client ID

## Important Notes

- The extension ID must match the one registered in Google Cloud Console
- If you change the extension ID (e.g., when publishing to Chrome Web Store), you'll need to update the OAuth credentials
- The scopes defined in `manifest.json` determine what user information the extension can access

## Alternative: Using Chrome's Default OAuth

If you don't want to set up a custom client ID, you can remove the `oauth2` section from `manifest.json`. Chrome will use its default OAuth client, but you'll have less control over the authentication flow.

