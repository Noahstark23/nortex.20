// Auto-logout utility for handling invalid/expired tokens
// This runs on EVERY API call and automatically logs out users if token is invalid

export const handleAuthError = (response: Response) => {
    if (response.status === 401 || response.status === 403) {
        // Token is invalid or expired - clean up and redirect
        localStorage.removeItem('nortex_token');
        localStorage.removeItem('nortex_user');
        localStorage.removeItem('nortex_tenant_id');
        localStorage.removeItem('nortex_tenant_data');

        // Redirect to login
        window.location.href = '/login?error=session_expired';
        return true;
    }
    return false;
};

// Enhanced fetch wrapper with automatic auth handling
export const authFetch = async (url: string, options: RequestInit = {}) => {
    const token = localStorage.getItem('nortex_token');

    if (!token) {
        window.location.href = '/login?error=no_session';
        throw new Error('No session');
    }

    const headers = {
        ...options.headers,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };

    const response = await fetch(url, { ...options, headers });

    // Auto-handle auth errors
    if (handleAuthError(response)) {
        throw new Error('Session expired');
    }

    return response;
};
