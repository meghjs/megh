import { defineConfig, type DefaultTheme } from 'vitepress';
import { writeLlmsFiles } from './llms';

const description = 'A TypeScript-first web framework built on Fastify.';

const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'Getting Started',
    items: [
      { text: 'Introduction', link: '/getting-started/introduction' },
      { text: 'Installation', link: '/getting-started/installation' },
      { text: 'Quick Start', link: '/getting-started/usage' },
      { text: 'Application', link: '/getting-started/application' },
    ],
  },
  {
    text: 'Fundamentals',
    items: [
      { text: 'Controllers', link: '/core-concept/controller' },
      { text: 'Dependency Injection', link: '/core-concept/dependency-injection' },
      { text: 'Configuration', link: '/core-concept/configuration' },
      { text: 'Middleware', link: '/core-concept/middleware' },
      { text: 'Validation', link: '/core-concept/validation' },
      { text: 'Error Handling', link: '/core-concept/error-handling' },
      { text: 'Authentication', link: '/core-concept/authentication' },
      { text: 'Request Context', link: '/core-concept/request-context' },
    ],
  },
  {
    text: 'Database',
    items: [
      { text: 'MeghORM', link: '/advanced/orm' },
      { text: 'Models', link: '/advanced/orm/models' },
      { text: 'Queries', link: '/advanced/orm/queries' },
      { text: 'Relations', link: '/advanced/orm/relations' },
      { text: 'Query Builder', link: '/advanced/orm/query-builder' },
      { text: 'Migrations', link: '/advanced/orm/migrations' },
      { text: 'Seeding and Factories', link: '/advanced/orm/seeding' },
      { text: 'TypeORM and Knex', link: '/advanced/database' },
    ],
  },
  {
    text: 'Techniques',
    items: [
      { text: 'Events', link: '/advanced/events' },
      { text: 'Queue', link: '/advanced/queue' },
      { text: 'Mail', link: '/advanced/mail' },
      { text: 'Scheduler', link: '/advanced/scheduler' },
      { text: 'Caching', link: '/advanced/caching' },
      { text: 'File Uploads', link: '/advanced/file-uploads' },
      { text: 'Views', link: '/advanced/views' },
      { text: 'Sessions', link: '/advanced/sessions' },
      { text: 'Logging', link: '/advanced/logging' },
      { text: 'Health Checks', link: '/advanced/health' },
      { text: 'Testing', link: '/advanced/testing' },
    ],
  },
  {
    text: 'Integrations',
    items: [
      { text: 'OpenAPI', link: '/microservices/openapi' },
      { text: 'WebSocket', link: '/microservices/websocket' },
    ],
  },
  {
    text: 'Extending',
    items: [{ text: 'Plugins', link: '/advanced/plugins' }],
  },
  {
    text: 'AI',
    items: [
      { text: 'MCP Server', link: '/ai/mcp' },
      { text: 'LLM Tools', link: '/ai/tools' },
    ],
  },
  {
    text: 'Production',
    items: [
      { text: 'Deployment', link: '/production/deployment' },
      { text: 'Security Hardening', link: '/production/security' },
    ],
  },
  {
    text: 'Reference',
    items: [
      { text: 'API Reference', link: '/reference/api' },
      { text: 'Versioning Policy', link: '/reference/versioning' },
      { text: 'FAQ and Troubleshooting', link: '/reference/faq' },
    ],
  },
  {
    text: 'CLI',
    items: [
      { text: 'Overview', link: '/cli/basic' },
      { text: 'Generators', link: '/cli/generators' },
      { text: 'Database Commands', link: '/cli/database' },
      {
        text: 'Scaffold',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/cli/scaffold/' },
          { text: 'Templates and Fields', link: '/cli/scaffold/templates' },
          { text: 'Domains', link: '/cli/scaffold/domains' },
          { text: 'Auth', link: '/cli/scaffold/auth' },
          { text: 'RBAC', link: '/cli/scaffold/rbac' },
        ],
      },
    ],
  },
  {
    text: 'Upgrade Guides',
    collapsed: true,
    items: [
      { text: 'Upcoming changes', link: '/getting-started/upgrading-next' },
      { text: 'Upgrading to 0.7', link: '/getting-started/upgrading-0.7' },
      { text: 'Upgrading to 0.6', link: '/getting-started/upgrading-0.6' },
      { text: 'Upgrading to 0.5.5', link: '/getting-started/upgrading-0.5' },
      { text: 'Moving from Avleon', link: '/getting-started/upgrading-megh' },
      { text: 'Upgrading to 0.4', link: '/getting-started/upgrading-0.4' },
      { text: 'Upgrading to 0.3', link: '/getting-started/upgrading' },
    ],
  },
];

export default defineConfig({
  // llms.txt, llms-full.txt and a .md copy of each page, for coding agents.
  buildEnd(site) {
    writeLlmsFiles({
      sidebar,
      srcDir: site.srcDir,
      outDir: site.outDir,
      summary:
        description +
        ' Decorator routing, dependency injection, validation, OpenAPI, MeghORM, queues, mail and a CLI, for building REST APIs in TypeScript.',
    });
  },
  srcDir: 'content',
  title: 'Megh',
  description,
  cleanUrls: true,
  lastUpdated: true,
  head: [['link', { rel: 'icon', href: '/favicon.ico' }]],

  themeConfig: {
    logo: '/megh-logo.svg',
    siteTitle: false,

    nav: [
      {
        text: 'Guide',
        link: '/getting-started/introduction',
        activeMatch: '^/(getting-started|core-concept|microservices|production)/|^/advanced/(?!orm|database)',
      },
      { text: 'Database', link: '/advanced/orm', activeMatch: '^/advanced/(orm|database)' },
      { text: 'CLI', link: '/cli/basic', activeMatch: '^/cli/' },
      { text: 'AI', link: '/ai/mcp', activeMatch: '^/ai/' },
      { text: 'Reference', link: '/reference/api', activeMatch: '^/reference/' },
      {
        text: 'v0.7.3',
        items: [
          { text: 'Upcoming changes', link: '/getting-started/upgrading-next' },
          { text: 'Upgrading to 0.7', link: '/getting-started/upgrading-0.7' },
          { text: 'Upgrading to 0.6', link: '/getting-started/upgrading-0.6' },
          { text: 'Upgrading to 0.5.5', link: '/getting-started/upgrading-0.5' },
          { text: 'Moving from Avleon', link: '/getting-started/upgrading-megh' },
          { text: 'Upgrading to 0.4', link: '/getting-started/upgrading-0.4' },
          { text: 'Upgrading to 0.3', link: '/getting-started/upgrading' },
          { text: 'Changelog', link: 'https://github.com/meghjs/megh/blob/main/packages/core/CHANGELOG.md' },
        ],
      },
    ],

    sidebar,

    outline: { level: [2, 3] },

    socialLinks: [{ icon: 'github', link: 'https://github.com/meghjs/megh' }],

    search: { provider: 'local' },

    editLink: {
      pattern: 'https://github.com/meghjs/meghjs.github.io/edit/main/content/:path',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Tareq Hossain',
    },
  },
});
