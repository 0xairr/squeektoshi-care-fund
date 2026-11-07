// After `vite build`: write the static shell and the Genesis head tag into dist/client/index.html,
// so any host (Node, Vercel, a CDN) serves a page that crawlers and the verifier can read without
// running JavaScript.
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const indexFile = path.join(root, 'dist', 'client', 'index.html')
const entry = path.join(root, 'dist', 'server', 'entry-server.js')

const { render, head } = await import(pathToFileURL(entry).href)
const html = readFileSync(indexFile, 'utf8').replace('<!--genesis-tag-->', head()).replace('<!--ssr-outlet-->', render())
writeFileSync(indexFile, html)
rmSync(path.join(root, 'dist', 'server'), { recursive: true, force: true })
console.log('prerendered', path.relative(root, indexFile))
