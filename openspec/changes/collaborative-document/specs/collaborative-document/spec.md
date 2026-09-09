## Purpose

Defines the shared document that humans and the agent both edit as equal participants: a browser editor bound to a CRDT-backed document, live presence with named cursors, and a server-side participant that can read the document as plain text and append to it so that every connected editor sees the result.

## ADDED Requirements

### Requirement: Shared document across participants

The system SHALL maintain a single logical document, replicated as a CRDT, that every connected participant edits concurrently. Concurrent edits from different participants SHALL merge without corruption and without lost characters, and all participants SHALL converge on identical content.

#### Scenario: Two browser tabs edit concurrently

- **WHEN** two browser tabs are open on the editor and text is typed in the first tab
- **THEN** that text appears in the second tab without a manual refresh

#### Scenario: Simultaneous typing converges

- **WHEN** two participants type into different parts of the document at the same time
- **THEN** both edits are preserved and both participants end up seeing identical document content

#### Scenario: Late joiner receives current state

- **WHEN** a new browser tab connects to a document that already contains content
- **THEN** the tab renders the existing content on load rather than an empty document

### Requirement: Editor undo is owned by the CRDT

The editor SHALL NOT run its own independent document history. Undo and redo SHALL be provided by the CRDT layer so that undoing reverts only the acting participant's own changes.

#### Scenario: Undo does not revert another participant's work

- **WHEN** participant A types, then participant B types, and then participant A issues undo
- **THEN** only participant A's own change is reverted and participant B's text remains intact

#### Scenario: Undo does not desynchronise participants

- **WHEN** any participant issues undo or redo
- **THEN** all participants remain converged on identical document content, with no corruption of the shared state

### Requirement: Live presence with named cursors

Each participant SHALL publish presence information comprising a display name and a distinct colour. Every other participant SHALL see that participant's caret position and text selection rendered live, labelled with their name and drawn in their colour.

#### Scenario: Remote caret is visible and labelled

- **WHEN** participant A places their caret in the document
- **THEN** participant B sees a caret marker at the corresponding position carrying participant A's name

#### Scenario: Remote selection is visible

- **WHEN** participant A selects a range of text
- **THEN** participant B sees that range highlighted in participant A's colour

#### Scenario: Presence is withdrawn on disconnect

- **WHEN** a participant disconnects
- **THEN** their cursor and selection markers are removed from the other participants' views

### Requirement: Server-side participant

A server-side process SHALL join the same document as a peer participant, indistinguishable in kind from a browser participant. It SHALL publish presence with the display name `Assistant` and a colour distinct from the human participants' colours.

#### Scenario: Server participant appears as a peer

- **WHEN** the server-side participant connects to the document
- **THEN** browser participants observe an additional participant present under the name `Assistant`

#### Scenario: Server participant joins the configured room

- **WHEN** the server-side participant starts
- **THEN** it connects to the same room and websocket endpoint that the browser editor uses, without requiring separate configuration to be kept in step by hand

### Requirement: Reading the document as plain text

The server-side participant SHALL expose an operation returning the current document content as plain text, reflecting all edits received up to the moment of the call. Block boundaries in the document SHALL be represented as line breaks in the returned text. The operation SHALL NOT return empty text for a document that has content.

#### Scenario: Read reflects browser edits

- **WHEN** a browser participant types text and the server-side participant's read operation is then invoked
- **THEN** the returned text contains that typed text

#### Scenario: Block structure becomes line breaks

- **WHEN** the document contains multiple paragraphs and the read operation is invoked
- **THEN** the returned text separates the paragraphs' contents with line breaks

#### Scenario: Non-empty document never reads as empty

- **WHEN** the document is known to contain visible content and the read operation is invoked
- **THEN** the returned text is non-empty

### Requirement: Server-side append

The server-side participant SHALL be able to append text to the end of the shared document. Appended content SHALL be structurally valid for the editor, SHALL render as ordinary document content in every connected editor, and SHALL be attributed to the server participant's presence.

#### Scenario: Appended text reaches every tab

- **WHEN** the server-side participant appends text while two browser tabs are connected
- **THEN** the appended text appears in both tabs live, without a refresh

#### Scenario: Appended content is well formed

- **WHEN** the server-side participant appends text
- **THEN** the content renders as a normal editable block in the editor, and the document remains editable and uncorrupted afterwards

#### Scenario: Append survives a subsequent read

- **WHEN** the server-side participant appends text and then invokes its read operation
- **THEN** the returned plain text includes the appended text

### Requirement: Single source of connection and field configuration

The room name, the websocket endpoint, and the name of the shared document field SHALL be defined in exactly one place, consumed by both the browser editor and the server-side participant. Changing any of these values in that one place SHALL take effect for both without further edits.

#### Scenario: Configuration is not duplicated

- **WHEN** the source is inspected for the room name, websocket URL, and field name
- **THEN** each value has exactly one definition, and both the browser and server code paths read it from there

#### Scenario: Changing the room affects both sides

- **WHEN** the room name is changed in its single definition
- **THEN** both the browser editor and the server-side participant connect to the new room without any other source change

### Requirement: Field mismatch is observable

Because a mismatch between the editor's document field and the field the server-side participant reads produces silent failure rather than an error, the server-side participant SHALL log the document's share keys and the field name it is using once its initial synchronisation with the room completes.

#### Scenario: Share keys are logged on sync

- **WHEN** the server-side participant completes its first synchronisation with the room
- **THEN** it emits a log line stating the document's share keys and the field name it is reading

#### Scenario: A mismatch is diagnosable from the log alone

- **WHEN** the field name the server participant uses is not present among the logged share keys
- **THEN** the discrepancy is evident from that single log line, without adding further instrumentation
