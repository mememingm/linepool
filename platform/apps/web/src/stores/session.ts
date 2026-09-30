import type { LoginInput, User } from '@linepool/contracts';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { ApiClientError, apiRequest } from '../services/api-client.js';

export const useSessionStore = defineStore('session', () => {
  const user = ref<User | null>(null);
  const isChecking = ref(false);
  const hasRestored = ref(false);
  const isAuthenticated = computed(() => user.value !== null);

  async function restore(force = false): Promise<void> {
    if (isChecking.value || (hasRestored.value && !force)) return;
    isChecking.value = true;
    try {
      user.value = await apiRequest<User>('/auth/me');
    } catch (error) {
      if (!(error instanceof ApiClientError && error.status === 401)) {
        throw error;
      }
      user.value = null;
    } finally {
      isChecking.value = false;
      hasRestored.value = true;
    }
  }

  async function login(input: LoginInput): Promise<void> {
    user.value = await apiRequest<User>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    hasRestored.value = true;
  }

  async function logout(): Promise<void> {
    await apiRequest<null>('/auth/logout', { method: 'POST' });
    user.value = null;
    hasRestored.value = true;
  }

  return { user, isChecking, isAuthenticated, restore, login, logout };
});
