# Jira-Amplify Timelog Sync

Chrome extension that syncs Jira worklogs to Amplify timesheets. Includes priority scoring, activity/project/task mapping, time stats, and a reminder system.

## Prerequisites

- Google Chrome (or any Chromium-based browser)
- An active Jira Cloud account (must be logged in)
- An Amplify account at `amplify.echologyx.com`
- [Git](https://git-scm.com) installed (for pulling updates)

## Installation

1. Download or clone this repository to your machine.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `Jira-Amplify Extension` folder.
5. The extension icon will appear in your toolbar. Pin it for quick access.

## First-Time Setup

> **Important:** The extension must be installed in the same Chrome profile where you are logged in to Jira. It reads Jira cookies from your browser session to authenticate. Amplify does not have this requirement — it uses its own login with the credentials you enter in Settings.

1. **Log in to Jira** in the same Chrome profile where the extension is installed — it auto-detects your Jira domain from cookies. No manual Jira configuration needed.
2. Click the extension icon and go to the **Settings** tab.
3. Enter your **Amplify Email** and **Amplify Password**, then click **Save Settings**.
   - Credentials are stored locally in Chrome storage. They are only sent to Amplify for authentication.
4. Your Jira profile card should appear at the top of Settings once detection succeeds.

## Time Offset

The extension converts Jira worklog timestamps to Amplify's timezone (BD / GMT+6).

- **Auto (recommended)** — detects your Jira timezone and applies the correct offset automatically. No conversion if Jira is already in an Asian timezone; +8 hours if European.
- Override manually only if synced times look wrong. The Settings tab shows a table of offsets with example conversions.

## Tabs

### Sync
Select a date range (calendar or presets like Today, Last 7 days, This month) and the extension will:
- Fetch your Jira worklogs for that period
- Fetch existing Amplify entries
- Show what needs to be created, what already exists, and any conflicts
- One-click sync to push new entries to Amplify

### Priority
Shows your assigned Jira tickets ranked by a universal priority score:

| Signal | Points | Description |
|---|---|---|
| Swimlane position | 0–30 | Higher lane on the board = higher score |
| Board column | 0–25 | Closer to the end of the workflow = higher score |
| Deadline | 0–50 | Overdue or approaching deadline = higher score |
| Jira priority | 0–15 | Highest/High/Medium/Low/Lowest |

Works across all roles — Developer, QA, Designer, E-com Manager. The extension detects your role from Jira custom fields and routes each ticket to the appropriate board (Development Pipeline, Quality Assurance, Design Master).

Excluded statuses: `Done`, `Won't Do`, `Selected for Setup Validation`, `Setup Validation in Progress`, `Ready to Launch`.

### Activity Map
Map Jira worklog comment codes (e.g., `201000`) to Amplify activities. If no code is found, the description text is auto-matched. Set a default activity for unmatched entries.

### Project Map
Map Jira project prefixes (e.g., `VET`, `TOU`) to Amplify projects. Used when auto-detection from Amplify history fails.

### Task Map
Override the project and/or activity for specific Jira tickets. Highest priority — overrides all other mappings.

### Stats
View worklog statistics for any date range: total hours, daily averages, breakdowns by project and activity.

## Troubleshooting

- **"Could not detect Jira domain"** — Make sure you are logged in to Jira Cloud in Chrome before opening the extension.
- **Sync times look wrong** — Go to Settings and manually set the Time Offset instead of Auto.
- **Priority shows no tickets** — Your Jira must have role fields (Developer, QA, Designer, or E-com Manager) assigned to your account on active tickets.
- **Amplify login fails** — Double-check your Amplify email and password. The extension authenticates via the Amplify web login flow.

## Updating

To update the extension after new changes are pushed:
1. Run `git pull` in the extension folder.
2. Go to `chrome://extensions` and click the reload icon on the Jira-Amplify Timelog Sync card.
