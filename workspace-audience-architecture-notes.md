# Workspace + Audience Architecture Notes

## Current situation
There are currently **4 workspaces** in the email platform:
1. DreamPlay Marketing
2. DreamPlay Support
3. MusicalBasics
4. Crossover
5. Concert Marketing

## Core requirement
Each workspace should have:
- its **own campaigns**
- its **own filtered audience view**
- its **own settings / operational context**

But a **person should not be limited to one workspace**.
A single person may belong to multiple workspace audiences.

---

## Recommended model

### 1. Workspace = campaign + audience context
A workspace should control:
- campaign organization
- templates
- workspace-scoped analytics
- workspace-scoped subscriber filtering
- workspace-scoped unsubscribe behavior

### 2. Person = can belong to multiple workspaces
A person should be able to appear in multiple workspace audiences.

Examples:
- someone can be in **MusicalBasics** and **DreamPlay Marketing**
- someone can be in **DreamPlay Marketing** and **Concert Marketing**
- someone can be in **DreamPlay Support** and also still exist elsewhere if needed

This should be driven by **workspace membership / tags**, not by pretending the subscriber exists in only one place.

---

## Important DreamPlay example
In the **DreamPlay Support** workspace, we currently have all of the people who purchased the keyboard.

Those people were originally moved from **DreamPlay Marketing** to **DreamPlay Support** via a clean transfer.

### Better model going forward
What should have happened instead:
- keep the person as part of the broader system identity
- add a **DreamPlay Support** workspace membership / tag
- remove the **DreamPlay Marketing** audience membership / tag if the goal is to prevent them from receiving broad marketing emails

### Why
Because the real business rule is not:
- "this person no longer exists in DreamPlay"

The real business rule is:
- "this person should no longer receive DreamPlay Marketing emails"
- but they **should** still be reachable in DreamPlay Support

That is an **audience membership problem**, not an identity problem.

---

## Best audience rule
A person can belong to multiple workspaces, but their **workspace membership state** should decide what they receive.

For example, a person could have:
- MusicalBasics = active
- DreamPlay Marketing = inactive / removed
- DreamPlay Support = active
- Concert Marketing = active

This gives much better control than hard-moving or duplicating people incorrectly.

---

## Recommended operational behavior

### DreamPlay Marketing
Contains people who should receive DreamPlay-related promotional / announcement campaigns.

### DreamPlay Support
Contains purchasers / customer support communication audience.

### MusicalBasics
Contains general educational / creator / music audience.

### Crossover
Contains intentionally overlapping audience segments for cross-brand campaigns.

### Concert Marketing
Contains people relevant to concert event promotion, ticket announcements, and event-driven campaigns.

---

## Recommended rule for purchasers
For DreamPlay purchasers:
- they should be in **DreamPlay Support**
- they should **not automatically remain in DreamPlay Marketing** if the goal is to avoid spamming them with promo emails
- instead, remove or disable their DreamPlay Marketing membership/tag

That gives you:
- support communication access
- no extra promotional spam
- cleaner segmentation

---

## Recommended architecture direction

### Short version
- campaigns belong to workspaces
- audience views belong to workspaces
- a person can belong to multiple workspaces
- membership in a workspace should be explicit
- unsubscribes / suppression should be scoped correctly

### Data model direction
Best long-term structure:
- global person/contact identity
- workspace membership records
- workspace-scoped tags/status

That is cleaner than forcing subscribers to live in only one workspace.

---

## Practical rule to implement
When starting a new marketing initiative:
- create a workspace if it needs its own campaign stream and audience management
- do **not** assume the audience is totally separate people
- instead assign the relevant people into that workspace audience

This is especially important now that **Concert Marketing** is being added.

---

## Final recommendation
The correct system is:
- **multiple workspaces** for clean campaign organization
- **shared people across workspaces** when appropriate
- **workspace membership / tags** controlling who receives what

And specifically for DreamPlay purchasers:
- they should be tagged / assigned to **DreamPlay Support**
- and removed from **DreamPlay Marketing** if you do not want them receiving those marketing emails
