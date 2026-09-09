## Purpose

Defines the runnable skeleton of the voice-document agent: the dependency set the later phases build on, a collaboration relay that can be started with one command, and documentation precise enough that all three processes can be brought up from a clean checkout without guesswork.

## ADDED Requirements

### Requirement: Node project and version control

The repository SHALL contain an initialised Node package with a committed manifest, and SHALL be under git version control with build output and dependency directories excluded from tracking.

#### Scenario: Clean checkout installs

- **WHEN** a contributor clones the repository and runs the documented install command
- **THEN** installation completes without error and no manual dependency resolution is required

#### Scenario: Generated files are not tracked

- **WHEN** dependencies are installed and the browser bundle is built
- **THEN** `git status` reports no untracked dependency or build-output files

### Requirement: Collaboration stack dependencies

The project manifest SHALL declare the collaboration stack as dependencies: `yjs`, `y-websocket`, `y-prosemirror`, `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-cursor`, and `ws`.

#### Scenario: Every stack package is declared

- **WHEN** the manifest is inspected after setup
- **THEN** each of the eight named packages appears as a dependency with a resolved version recorded in the lockfile

### Requirement: Collaboration relay runs on a documented port

The project SHALL provide a script that starts a y-websocket relay listening on port 1234. The relay SHALL be the stock upstream implementation invoked via `npx y-websocket`; the project SHALL NOT ship its own websocket relay implementation.

#### Scenario: Relay starts on port 1234

- **WHEN** the operator runs the documented relay script
- **THEN** a websocket server accepts connections on port 1234 and reports that it is listening

#### Scenario: No bespoke relay exists

- **WHEN** the repository source is inspected
- **THEN** no project-authored websocket server implementation is present, and the relay script delegates to the upstream `y-websocket` binary

### Requirement: Documented startup procedure

The repository SHALL include a README giving the exact commands, in order, to start the collaboration relay, serve the browser editor page, and run the server-side participant, including the URL at which the editor page is reached.

#### Scenario: Operator follows the README end to end

- **WHEN** a contributor with no prior knowledge of the project follows the README from a clean checkout
- **THEN** they reach a state where two browser tabs and the server participant are all connected to the same document, without consulting source code

#### Scenario: README states process count and order

- **WHEN** the README is read
- **THEN** it identifies each process that must run, the command for it, and which processes must be started before which
