# Using ReadyCode Companion

## Start on Windows

Download the [Windows x64 preview](https://github.com/ReadycodeAI/readycode-companion/releases/tag/preview-windows-1.0.0). This installer is unsigned. Follow the release notes to verify its checksum and handle the Windows publisher prompt. Install it under the Windows account you use for chat. If you used the portable app, close it first. Open Companion, select **Connect ReadyCode Account**, sign in and enter the eight-character code from [device pairing](https://readycode.ai/account/device/pair). If an upgrade asks you to pair again, use the same ReadyCode account, then check your synced conversations in the sidebar and [web chat room](https://readycode.ai/account/chat-room).

## Send your first message

- **GroqCloud** lets you start with your own provider key and its available free allowance. Select GroqCloud, save your key in Settings, choose a model, and send a message. The desktop stores the key using Windows secure storage.
- **ReadyCode Agents** uses the agents and credentials you configured on the website. Select one agent to chat. The cloud can search when the question calls for web sources. Use **AI setup** and **Refresh agents** if your agent is missing.
- **Ask the room** appears beside ReadyCode Agents. Check it, select the agents you want, and choose **Send to N agents**. Each agent answers the same message and gets its own receipt. Each reply uses that provider’s allowance or billing.

## Read a savings receipt

Under a reply, compare the estimated input tokens before and after ReadyCode prepared that request. **Optimal context · 0% compaction needed** means ReadyCode sent the context whole. You can still save that conversation. A receipt measures input for that reply. Output tokens, provider prices and how many agents you selected also affect your bill. [See ReadyCode’s savings examples](https://readycode.ai/savings).

## Return to a chat or clean up the sidebar

Look for **Saved to ReadyCode** before relying on the online copy. Open **Cloud chat room** to find your synced conversation. If a turn shows a sync error, check your connection and its sync status before removing the local copy.

Click **×** beside a chat and choose **Remove from this device** to keep the synced chat online. Choosing **Delete here and on ReadyCode** also deletes the online room after the server confirms. Other devices may still have a cached copy.

## Attach a file

Choose **Attach files**, select the documents, and ask a specific question. PDF, DOCX and XLSX go to ReadyCode Reader. It checks excerpts before sending them to the selected agent. Passage checking requires an OpenRouter key in your ReadyCode account. If Reader cannot verify a passage, the turn stops. For a scanned PDF, use a searchable copy. For supported plain-text attachments, the full text becomes part of the message and synced history.

In desktop version 1.0.1, a document turn lists the filenames and cited locations that Reader selected, once for the whole turn. Reader compares the extracted text with the cited excerpts only when the cloud returns exact counts from the same tokenizer. Otherwise the receipt says the savings were not measured. These are document-input counts before chat compaction. They exclude Reader’s verification work and do not measure billing. Each agent’s own chat-compaction receipt appears separately. Earlier desktop versions show the excerpts in the prompt.

## Updates and cost

Official signed Windows releases check for updates automatically. You can also check in **Settings**. Finish your current turn, then choose **Restart to update**. The unsigned test installer uses manual updates. Pairing may be required again if a device is revoked or its profile changes.

ReadyCode account access is currently free and may carry a fee in the future. Provider charges and free-tier limits apply separately. Your paired account is required to send chats.
### Looking up an older decision

Single-agent chat and Ask the room request automatic lookup from ReadyCode Cloud. A reply confirms retrieval only when its cloud receipt reports it. Older servers may ignore the request. **Find an earlier message** searches your own messages already loaded in this chat; **Quote in draft** copies the entire selected message so you can review it before sending. It does not search other rooms or send anything by itself.
