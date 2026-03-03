# Skill Tree Builder

An interactive, force-directed skill tree visualiser built with React, TypeScript, and Vite. Browse, customise, and export a radial graph of skills organised across four domains: **Development**, **Research**, **Communication**, and **Organisation**.

## Features

- **Interactive SVG canvas** – pan by dragging the background and zoom with the scroll wheel
- **Focus mode** – click any node to centre and enlarge it
- **Add nodes** – attach custom child nodes to any existing node, with a free-choice colour
- **Move nodes** – drag individual nodes to reposition them manually (press **M** or use the toolbar button to toggle move mode)
- **Delete nodes** – remove a node and all its descendants with a confirmation prompt
- **Clean up layout** – re-run the force-directed spring simulation to tidy the graph
- **Export / Import** – save the full tree (positions, custom nodes, colour overrides) as a JSON file and reload it later
- **i18n ready** – UI strings are externalised via `react-i18next`; English is the default locale

## Tech Stack

| Layer | Library |
|---|---|
| Framework | [React 18](https://react.dev) + [TypeScript](https://www.typescriptlang.org) |
| Build tool | [Vite](https://vitejs.dev) |
| UI components | [MUI v6](https://mui.com) + [Emotion](https://emotion.sh) |
| Design system | [@codegouvfr/react-dsfr](https://github.com/codegouvfr/react-dsfr) |
| Internationalisation | [i18next](https://www.i18next.com) / [react-i18next](https://react.i18next.com) |
| Routing | [React Router v7](https://reactrouter.com) |

## Prerequisites

- **Node.js** ≥ 18
- **Yarn** ≥ 1.22

## Getting Started

### 1. Install dependencies

```bash
yarn
```

### 2. Start the development server

```bash
yarn dev
```

The app will be available at [http://localhost:5173](http://localhost:5173) by default.

### 3. Build for production

```bash
yarn build
```

The compiled output is written to `dist/`.

### 4. Preview the production build

```bash
yarn preview
```

### 5. Lint

```bash
yarn lint
```

## Project Structure

```
deploy/
├── deploy.sh                # Build-and-deploy script (run locally)
└── nginx.conf               # nginx server block template
src/
├── App.tsx                  # Root component
├── main.tsx                 # Entry point – initialises DSFR & i18n
├── vite-env.d.ts
├── components/
│   └── SkillTree.tsx        # Full skill tree component (layout, interaction, SVG rendering)
├── data/
│   └── skillTree.ts         # Default tree data (SkillNode interface + root definition)
└── i18n/
    ├── index.ts             # i18next initialisation
    ├── en.ts                # English translations
    └── fr.ts                # French translations
```

## Deployment

The `deploy/` directory contains a shell script and an nginx configuration to host the app on any Debian/Ubuntu VM.

```
deploy/
├── deploy.sh    # Build-and-push script (runs locally)
└── nginx.conf   # nginx server block (copied to the VM)
```

### Prerequisites on your local machine

- `yarn` and Node.js ≥ 18 (to build)
- `rsync` and `ssh`
- An SSH key authorised on the target VM (`~/.ssh/id_rsa` by default)

### Prerequisites on the VM

- Debian or Ubuntu (the script installs nginx via `apt` if it is not already present)
- The deploy user must have **passwordless `sudo`** (or nginx must already be installed and the user must own `/var/www/`)

### Quick start

```bash
# Deploy the built app only (default)
./deploy/deploy.sh --host 203.0.113.42

# Also install / update the nginx config on the VM
./deploy/deploy.sh --host 203.0.113.42 --with-nginx

# Full example with all options
./deploy/deploy.sh \
  --host 203.0.113.42 \
  --user ubuntu \
  --key ~/.ssh/my_vm_key \
  --port 22 \
  --dir /var/www/skill-tree-builder \
  --with-nginx
```

You can also export the variables instead of passing flags every time:

```bash
export DEPLOY_HOST=203.0.113.42
export DEPLOY_USER=ubuntu
export DEPLOY_KEY=~/.ssh/my_vm_key
./deploy/deploy.sh
```

### What the script does

| Step | Action |
|---|---|
| 1 | Runs `yarn build` locally → produces `dist/` |
| 2 | Creates `REMOTE_DIR` on the VM and sets ownership |
| 3 | Rsyncs `dist/` to the VM (incremental, deletes stale files) |
| 4 *(opt-in)* | Installs nginx on the VM if not already present |
| 5 *(opt-in)* | Copies `deploy/nginx.conf` to `/etc/nginx/sites-available/`, enables it, reloads nginx |

By default only steps 1–3 run. Pass `--with-nginx` to also configure the web server (steps 4–5).

### Adding HTTPS

Point a domain at the VM and run [Certbot](https://certbot.eff.org/) after deployment:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.example.com
```

---

## Customising the Default Tree

Edit [`src/data/skillTree.ts`](src/data/skillTree.ts) to change the built-in skill hierarchy. Each node follows the `SkillNode` interface:

```ts
interface SkillNode {
  id: string;
  labelKey: string;          // i18n key (e.g. 'skillTree.react') or 'custom:…' for runtime nodes
  label?: string;            // raw label for custom nodes (bypasses i18n)
  colorOverride?: string;    // hex colour override
  positionOffset?: { x: number; y: number }; // manual position offset on top of layout
  children?: SkillNode[];
}
```

Add corresponding translation keys for any new nodes in [`src/i18n/en.ts`](src/i18n/en.ts) under the `skillTree` namespace.

## Adding a New Language

1. Create `src/i18n/<locale>.ts` modelled on `en.ts`.
2. Register the new resource in `src/i18n/index.ts`.
3. Set the desired `lng` in the i18next config or implement a language-switcher component.

## Export / Import Format

The **Export tree** button downloads a JSON file with the following shape:

```json
{
  "treeId": "skill-tree",
  "version": 1,
  "nodes": [
    {
      "id": "react",
      "label": "React",
      "parentId": "frontend",
      "colorOverride": "#38bdf8",
      "position": { "x": 420.5, "y": -180.2 }
    }
  ]
}
```

Use **Import tree** to restore a previously exported file. Any nodes present in the file but absent from the current data will be re-added as custom nodes; nodes not in the file will retain their auto-layout positions.
