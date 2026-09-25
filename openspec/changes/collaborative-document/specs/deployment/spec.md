## Purpose

Defines what the publicly deployed service must do: be reachable securely,
give each visitor their own document, keep the team's credentials off the
client, and bound what a single visitor can spend.

## ADDED Requirements

### Requirement: The live service is reachable over a secure connection

The system SHALL serve the editor page and all of its connections over secure
transports, so that speech input works away from a developer machine.

#### Scenario: A visitor opens the live URL

- **WHEN** a visitor opens the deployed editor on any network
- **THEN** the page loads over `https`, its document connection and its speech connection are secure, and the browser permits microphone access

#### Scenario: Local development is unchanged

- **WHEN** the project is run locally with no deployment configuration set
- **THEN** it behaves exactly as it did before deployment existed

### Requirement: Each visitor gets their own document

The system SHALL isolate visitors into separate documents by default, and
SHALL let people share one deliberately.

#### Scenario: Two unrelated visitors do not share a document

- **WHEN** two people open the live URL separately
- **THEN** neither sees the other's text, cursor, or agent activity

#### Scenario: A shared link shares the document

- **WHEN** one visitor shares their document link and another opens it
- **THEN** both edit the same document and see each other's cursors

#### Scenario: A new visitor has something to work with

- **WHEN** a visitor opens a document that has no content
- **THEN** starter content appears so the agent has text to act on, and existing content is never overwritten

### Requirement: Credentials never reach the browser

The system SHALL keep every third-party API credential on the server side.

#### Scenario: The published site contains no secrets

- **WHEN** the deployed browser bundle is inspected
- **THEN** it contains no API key for any third-party service

### Requirement: One visitor cannot exhaust the service

The system SHALL bound how often a single visitor can trigger paid operations,
and SHALL degrade visibly rather than silently when limits or credits run out.

#### Scenario: A visitor exceeding the limit is told

- **WHEN** a visitor requests speech passes or sends instructions faster than the configured limit
- **THEN** the request is refused with a message the page displays, and the visitor can continue once the limit resets

#### Scenario: Cancelling always works

- **WHEN** a visitor is over the limit and interrupts the agent
- **THEN** the cancellation is still honoured

#### Scenario: Missing credentials fail clearly, not silently

- **WHEN** the deployed service is missing a third-party credential
- **THEN** the app still loads and shows a clear message for the affected feature, and unaffected features keep working
