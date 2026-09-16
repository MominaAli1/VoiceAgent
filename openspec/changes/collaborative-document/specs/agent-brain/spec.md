## Purpose

Defines the LLM-driven decision loop that turns a typed instruction into a
document edit: the entry point that receives an instruction, the tool-use
call to Groq, the `edit_doc` and `search_web` tool contracts, throttled
insertion so edits read as typed rather than pasted, and the browser-side
control that submits an instruction in the first place.

## ADDED Requirements

### Requirement: Typed instruction entry point

The system SHALL provide a single server-side entry point that accepts a
plain-text instruction and, in response, reads the current document, decides
what action to take, and applies at most one resulting edit per completed
attempt. The browser SHALL provide a visible control through which a user
submits such an instruction.

#### Scenario: Submitting an instruction is acknowledged

- **WHEN** a user types an instruction into the browser control and submits it
- **THEN** the browser receives a prompt acknowledgement that the instruction was accepted, without waiting for the resulting edit to complete

#### Scenario: A rejected instruction is visible, not silent

- **WHEN** an instruction is submitted with no text, or the server rejects it before processing begins
- **THEN** the browser displays the rejection rather than discarding it silently

#### Scenario: The resulting edit is observed through the document itself

- **WHEN** an accepted instruction results in a document change
- **THEN** that change becomes visible to every connected participant through the same document-sync mechanism as any other participant's edit, with no separate notification channel required

### Requirement: Tool-calling loop against the live document

The system SHALL send the current document content, the instruction, and the
available tools to an LLM, execute whichever tool the LLM selects, and
return the tool's result to the LLM until it produces a response requiring
no further tool call, up to a fixed retry limit.

#### Scenario: A valid edit instruction results in exactly one tool execution

- **WHEN** an instruction unambiguously identifies one existing passage and its replacement
- **THEN** the corresponding edit tool is called once and the document reflects the change

#### Scenario: A tool failure triggers a retry, not a crash or a corrupted edit

- **WHEN** a tool call fails (for example, the referenced text cannot be found)
- **THEN** the failure is returned to the LLM as a descriptive error and a further attempt is made, without leaving the document in a partially edited or corrupted state

#### Scenario: Repeated failure ends in a clear, bounded failure

- **WHEN** an instruction fails on every attempt up to the retry limit
- **THEN** the system stops retrying and reports a clear failure rather than looping indefinitely or silently giving up with no signal

#### Scenario: A response with no tool call does not silently succeed

- **WHEN** the LLM responds without calling any tool and no document change has occurred yet for the current instruction
- **THEN** the system treats this as not yet complete and re-prompts requiring a tool call, rather than treating the turn as finished

### Requirement: Exact find-and-replace editing, scoped to one paragraph

The system SHALL provide an edit tool that locates an exact, verbatim
substring within the document and replaces it, without relying on character
or word position counting. A single invocation SHALL be limited to text
located entirely within one paragraph.

#### Scenario: An exact match is replaced correctly

- **WHEN** the edit tool is invoked with text that exists verbatim exactly once in the document
- **THEN** that exact text is replaced with the requested replacement, and the rest of the document is unchanged

#### Scenario: A missing match is reported, not guessed

- **WHEN** the edit tool is invoked with text that does not exist verbatim anywhere in the document
- **THEN** the tool returns a descriptive error identifying that the text was not found, and makes no change to the document

#### Scenario: An ambiguous match is reported, not silently resolved

- **WHEN** the edit tool is invoked with text that exists verbatim in more than one place
- **THEN** the tool returns a descriptive error identifying the ambiguity, and makes no change to the document

#### Scenario: A match spanning paragraphs is rejected, not partially applied

- **WHEN** the edit tool is invoked with text that spans more than one paragraph
- **THEN** the tool returns a descriptive error rather than editing only part of the requested text or editing the wrong paragraph

#### Scenario: A stale match is caught at the moment of the edit

- **WHEN** the document changed after the LLM last read it, in a way that removes or alters the text the edit tool was asked to find
- **THEN** the tool re-reads the document immediately before editing and reports the same "not found" or "ambiguous" outcome that a genuinely wrong instruction would produce, rather than editing against an outdated view

### Requirement: Insertion reads as typed, not pasted

New text produced by the system — both appended text and the replacement
half of an edit — SHALL be inserted incrementally, in small chunks with a
brief pause between chunks, rather than appearing as a single instantaneous
write. Removal of existing text SHALL NOT be throttled.

#### Scenario: An appended paragraph streams in

- **WHEN** the system appends a new paragraph to the document
- **THEN** connected participants observe the paragraph's text appearing incrementally over a short interval, not all at once

#### Scenario: A replacement streams in after an instant removal

- **WHEN** the system performs an edit that removes existing text and inserts replacement text
- **THEN** the removal happens immediately and the replacement text then appears incrementally, not instantly

### Requirement: Search is exposed as a tool, without a live backend

The system SHALL expose a web-search tool to the LLM so that the tool-calling
loop can be exercised for search-shaped instructions, without performing a
real network search in this capability.

#### Scenario: A search-shaped instruction completes without hanging or erroring

- **WHEN** an instruction implies a need for current information the document does not contain
- **THEN** the search tool is available to be called, its result is a fixed response indicating search is not yet available, and the overall instruction still completes rather than hanging or failing the whole turn

### Requirement: A missing credential fails loudly at startup

The system SHALL require its LLM API credential to be present at process
startup and SHALL fail immediately and visibly if it is not, rather than
starting normally and failing silently on the first instruction.

#### Scenario: Startup without a credential is an immediate, clear error

- **WHEN** the server-side agent process starts without its LLM API credential configured
- **THEN** it fails at startup with an error naming the missing configuration, before it can accept any instruction
