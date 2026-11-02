# Megh Documentation

Source for [meghjs.github.io](https://meghjs.github.io/), the documentation
site for [Megh](https://github.com/meghjs/megh), a TypeScript-first
web framework built on Fastify. The site is built with
[VitePress](https://vitepress.dev).

## Development

Requires Node.js 22 or newer.

```sh
npm install
npm run dev       # dev server at http://localhost:5173
npm run build     # static build in .vitepress/dist
npm run preview   # serve the build locally
```

`npm run build` fails on dead internal links, so run it before opening a pull
request.

## Layout

```
content/                 Markdown pages; the folder path is the URL
├── index.md             Home page
├── getting-started/
├── core-concept/
├── advanced/
├── microservices/       OpenAPI and WebSocket
├── ai/
├── cli/
└── public/              Static files served from /
.vitepress/
├── config.mts           Nav, sidebar, search and footer
└── theme/               Theme colours
```

To add a page, create a Markdown file under `content/` with a `title` and
`description` in its frontmatter, then add it to `sidebar` in
`.vitepress/config.mts`.

## Deployment

Pushing to `main` builds the site and deploys it to GitHub Pages
(`.github/workflows/deploy.yml`).

## License

MIT

## Author

Tareq Hossain - [GitHub](https://github.com/xtareq)
