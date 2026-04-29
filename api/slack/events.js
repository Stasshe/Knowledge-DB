export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK")
  }

  let body = req.body

  if (typeof body === "string") {
    body = JSON.parse(body)
  }

  if (body?.type === "url_verification") {
    return res.status(200).send(body.challenge)
  }

  const event = body.event

  if (
    event?.type === "message" &&
    event.channel === process.env.SLACK_TARGET_CHANNEL_ID
  ) {
    // 新規投稿
    if (
      event.user === process.env.SLACK_TARGET_USER_ID &&
      !event.bot_id &&
      !event.subtype
    ) {
      await appendToGithub(formatEntry(event), event.ts)
    }

    // 編集投稿
    if (
      event.subtype === "message_changed" &&
      event.message?.user === process.env.SLACK_TARGET_USER_ID &&
      !event.message?.bot_id
    ) {
      await updateGithubEntry(event.message)
    }
  }

  return res.status(200).send("OK")
}

// --- Markdown整形 ---
function formatEntry(event) {
  const time = new Date(parseFloat(event.ts) * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 16)

  const text = event.text ?? ""

  return `
<!-- slack-ts:${event.ts} -->
## ${time}

${text}

---
`
}

// --- 新規append ---
async function appendToGithub(entry, ts) {
  const path = getFilenameFromSlackTs(ts)
  const { url, headers } = getGithubRequest(path)

  const getRes = await fetch(url, { headers })

  let content = ""
  let sha = null

  if (getRes.ok) {
    const data = await getRes.json()
    content = Buffer.from(data.content, "base64").toString()
    sha = data.sha
  }

  // 重複防止
  const slackTs = extractSlackTs(entry)
  if (slackTs && content.includes(`<!-- slack-ts:${slackTs} -->`)) {
    return
  }

  const newContent = content + entry

  await putGithubContent({
    url,
    headers,
    content: newContent,
    sha,
    message: "append knowledge"
  })
}

// --- 編集反映 ---
async function updateGithubEntry(message) {
  const path = getFilenameFromSlackTs(message.ts)
  const { url, headers } = getGithubRequest(path)

  const getRes = await fetch(url, { headers })
  if (!getRes.ok) return

  const data = await getRes.json()
  const content = Buffer.from(data.content, "base64").toString()

  const newEntry = formatEntry(message).trim() + "\n"

  const pattern = new RegExp(
    `<!-- slack-ts:${escapeRegExp(message.ts)} -->[\\s\\S]*?(?=\\n<!-- slack-ts:|$)`
  )

  if (!pattern.test(content)) return

  const newContent = content.replace(pattern, newEntry)

  await putGithubContent({
    url,
    headers,
    content: newContent,
    sha: data.sha,
    message: "update knowledge entry"
  })
}

// --- GitHub共通 ---
function getGithubRequest(path) {
  const url = `https://api.github.com/repos/${process.env.GITHUB_REPO}/contents/${path}`

  const headers = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    "Content-Type": "application/json"
  }

  return { url, headers }
}

async function putGithubContent({ url, headers, content, sha, message }) {
  const body = {
    message,
    content: Buffer.from(content).toString("base64")
  }

  if (sha) {
    body.sha = sha
  }

  await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(body)
  })
}

// --- ファイル名 ---
function getFilenameFromSlackTs(ts) {
  const date = new Date(parseFloat(ts) * 1000)
  const year = date.getFullYear()
  const week = String(getISOWeek(date)).padStart(2, "0")

  return `knowledge/${year}-W${week}.md`
}

// --- ISO週番号 ---
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7

  d.setUTCDate(d.getUTCDate() + 4 - dayNum)

  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))

  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
}

// --- util ---
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function extractSlackTs(entry) {
  const match = entry.match(/<!-- slack-ts:(.*?) -->/)
  return match?.[1]
}