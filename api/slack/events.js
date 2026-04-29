export default async function handler(req, res) {
  const body = req.body

  // Slack URL検証
  if (body.type === "url_verification") {
    return res.status(200).send(body.challenge)
  }

  const event = body.event

  // フィルタ：自分のtimesチャンネルのみ
  if (
    event?.type === "message" &&
    event.channel === process.env.SLACK_TARGET_CHANNEL_ID &&
    event.user === process.env.SLACK_TARGET_USER_ID &&
    !event.bot_id &&
    !event.subtype
  ) {
    const entry = formatEntry(event)
    await appendToGithub(entry)
  }

  return res.status(200).end()
}

// --- Markdown整形 ---
function formatEntry(event) {
  const time = new Date(parseFloat(event.ts) * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 16)

  return `
## ${time}

${event.text}

---
`
}

// --- 週番号 ---
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
}

function getFilename() {
  const now = new Date()
  const year = now.getFullYear()
  const week = String(getISOWeek(now)).padStart(2, "0")
  return `knowledge/${year}-W${week}.md`
}

// --- GitHub append ---
async function appendToGithub(entry) {
  const path = getFilename()

  const url = `https://api.github.com/repos/${process.env.GITHUB_REPO}/contents/${path}`

  const headers = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    "Content-Type": "application/json"
  }

  // 既存ファイル取得
  const getRes = await fetch(url, { headers })

  let content = ""
  let sha = null

  if (getRes.ok) {
    const data = await getRes.json()
    content = Buffer.from(data.content, "base64").toString()
    sha = data.sha
  }

  const newContent = content + entry

  // 更新
  await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: "append knowledge",
      content: Buffer.from(newContent).toString("base64"),
      sha
    })
  })
}