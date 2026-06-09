import { describe, it, expect } from 'vitest';
import { isPageOrRoute, mapToPages } from '../../../core/src/impact/component-mapper.js';
import { ImpactNode } from '../../../core/src/impact/types.js';

describe('Component-to-Page Mapper', () => {
  describe('isPageOrRoute', () => {
    it('should detect standard React/Next.js pages', () => {
      expect(isPageOrRoute('src/pages/Login.tsx')).toBe(true);
      expect(isPageOrRoute('pages/api/users.ts')).toBe(true);
      expect(isPageOrRoute('app/dashboard/page.tsx')).toBe(true);
      expect(isPageOrRoute('app/api/auth/route.ts')).toBe(true);
    });

    it('should detect SvelteKit routes', () => {
      expect(isPageOrRoute('src/routes/profile/+page.svelte')).toBe(true);
      expect(isPageOrRoute('src/routes/api/data/+server.ts')).toBe(true);
    });

    it('should detect Vue/React views and screens', () => {
      expect(isPageOrRoute('src/views/Home.vue')).toBe(true);
      expect(isPageOrRoute('src/screens/SettingsScreen.tsx')).toBe(true);
    });

    it('should reject normal components and utils', () => {
      expect(isPageOrRoute('src/components/Button.tsx')).toBe(false);
      expect(isPageOrRoute('src/utils/format.ts')).toBe(false);
      expect(isPageOrRoute('lib/helpers.js')).toBe(false);
    });
  });

  describe('mapToPages', () => {
    it('should correctly group impacted pages and routes by changed component', () => {
      const impactedFiles: ImpactNode[] = [
        {
          file: 'src/components/Button.tsx',
          importedSymbols: [],
          proximity: 0,
          relevanceScore: 1.0,
          importChain: ['src/components/Button.tsx'],
        },
        {
          file: 'src/pages/Login.tsx',
          importedSymbols: ['Button'],
          proximity: 1,
          relevanceScore: 1.0,
          importChain: ['src/components/Button.tsx', 'src/pages/Login.tsx'],
        },
        {
          file: 'app/api/auth/route.ts',
          importedSymbols: ['authHelper'],
          proximity: 1,
          relevanceScore: 1.0,
          importChain: ['src/utils/auth.ts', 'app/api/auth/route.ts'],
        },
        {
          file: 'src/components/Header.tsx',
          importedSymbols: ['Button'],
          proximity: 1,
          relevanceScore: 1.0,
          importChain: ['src/components/Button.tsx', 'src/components/Header.tsx'],
        },
        {
          file: 'src/views/Dashboard.vue',
          importedSymbols: ['Header'],
          proximity: 2,
          relevanceScore: 0.7,
          importChain: ['src/components/Button.tsx', 'src/components/Header.tsx', 'src/views/Dashboard.vue'],
        }
      ];

      const results = mapToPages(impactedFiles, '/repo');

      expect(results).toHaveLength(2);

      const buttonImpact = results.find(r => r.component === 'src/components/Button.tsx');
      expect(buttonImpact).toBeDefined();
      expect(buttonImpact?.pages).toContain('src/pages/Login.tsx');
      expect(buttonImpact?.pages).toContain('src/views/Dashboard.vue');
      expect(buttonImpact?.routes).toHaveLength(0);

      const authImpact = results.find(r => r.component === 'src/utils/auth.ts');
      expect(authImpact).toBeDefined();
      expect(authImpact?.routes).toContain('app/api/auth/route.ts');
      expect(authImpact?.pages).toHaveLength(0);
    });
  });
});
