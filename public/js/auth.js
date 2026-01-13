// Authentication utilities

const TOKEN_KEY = 'supabase_token';
const USER_KEY = 'supabase_user';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getUser() {
  const userJson = localStorage.getItem(USER_KEY);
  return userJson ? JSON.parse(userJson) : null;
}

export function setUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isAuthenticated() {
  return !!getToken();
}

export async function login(email, password) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Login failed');
  }

  // Store token and user
  setToken(data.data.session.access_token);
  setUser(data.data.user);

  return data.data;
}

export function logout() {
  clearAuth();
  window.location.href = '/login.html';
}

export async function checkAuth() {
  if (!isAuthenticated()) {
    window.location.href = '/login.html';
    return null;
  }

  try {
    const response = await fetch('/api/auth/me', {
      headers: {
        'Authorization': `Bearer ${getToken()}`,
      },
    });

    const data = await response.json();

    if (!data.success) {
      logout();
      return null;
    }

    return data.data.user;
  } catch (error) {
    console.error('Auth check failed:', error);
    logout();
    return null;
  }
}
