const express = require("express")
const multer  = require("multer")
const fs      = require("fs")
const cors    = require("cors")
const { createClient } = require("@supabase/supabase-js")

const app = express()
app.use(cors())
app.use(express.json())

const SUPABASE_URL = process.env.SUPABASE_URL || "https://iwggwgepwbrvmmrgsrvr.supabase.co"
const SUPABASE_KEY = process.env.SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3Z2d3Z2Vwd2Jydm1tcmdzcnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1Mzc4ODcsImV4cCI6MjA4OTExMzg4N30.BFaHUNavW7VOApg35r01SHsfjgYKUnhlT7YSADF9H6U"

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

if (!fs.existsSync("temp")) fs.mkdirSync("temp")
const livrosFile = "livros.json"
if (!fs.existsSync(livrosFile)) fs.writeFileSync(livrosFile, "[]")

const ADMIN_USER = "admin"
const ADMIN_PASS = "1234"

const upload = multer({ dest: "temp/" })

// ─── ROTAS ────────────────────────────────────────────────

app.get("/", (req, res) => res.json({ status: "API funcionando" }))

// ── Login admin (credenciais hardcoded) ──
app.post("/login", (req, res) => {
  const { user, password } = req.body
  if (user === ADMIN_USER && password === ADMIN_PASS) {
    res.json({ status: "ok", role: "admin" })
  } else {
    res.status(401).json({ status: "erro", message: "Credenciais inválidas" })
  }
})

// ── Registro de usuário comum (Supabase Auth) ──
app.post("/registro", async (req, res) => {
  const { email, password, username } = req.body

  if (!email || !password || !username) {
    return res.status(400).json({ status: "erro", message: "Preencha todos os campos." })
  }
  if (password.length < 6) {
    return res.status(400).json({ status: "erro", message: "A senha deve ter no mínimo 6 caracteres." })
  }

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } }
    })

    if (error) throw error

    res.json({ status: "ok", message: "Conta criada com sucesso!" })
  } catch (err) {
    const msg = err.message.includes("already registered")
      ? "Este e-mail já está cadastrado."
      : err.message
    res.status(400).json({ status: "erro", message: msg })
  }
})

// ── Login de usuário comum (Supabase Auth) ──
app.post("/loginUsuario", async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ status: "erro", message: "Preencha todos os campos." })
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) throw error

    const username = data.user.user_metadata?.username || email.split("@")[0]
    const user_id   = data.user.id
    res.json({ status: "ok", role: "user", username, user_id })
  } catch (err) {
    const msg = err.message.includes("Invalid login")
      ? "E-mail ou senha incorretos."
      : err.message
    res.status(401).json({ status: "erro", message: msg })
  }
})

// ── Listar livros ──
app.get("/livros", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("livros").select("*").order("id", { ascending: false })
    if (error) throw error
    res.json(data)
  } catch (err) {
    const livros = JSON.parse(fs.readFileSync(livrosFile))
    res.json(livros)
  }
})

// ── Adicionar livro ──
app.post("/addLivro", upload.single("arquivo"), async (req, res) => {
  try {
    const { titulo, autor = "", descricao = "", tags: tagsRaw = "" } = req.body
    const tags = (tagsRaw.match(/#[\wÀ-ú]+/g) || []).map(t => t.slice(1).toLowerCase())

    if (!req.file) return res.status(400).json({ status: "erro", message: "Nenhum arquivo enviado" })
    if (!titulo)   return res.status(400).json({ status: "erro", message: "Título obrigatório" })

    const filePath  = req.file.path
    const ext       = req.file.originalname.split(".").pop()
    const fileName  = `${Date.now()}-${titulo.replace(/\s+/g, "_")}.${ext}`
    const fileBuffer = fs.readFileSync(filePath)

    const { error: uploadError } = await supabase.storage
      .from("livros").upload(fileName, fileBuffer, { contentType: req.file.mimetype, upsert: false })
    if (uploadError) throw uploadError

    const publicUrl = supabase.storage.from("livros").getPublicUrl(fileName).data.publicUrl

    const { error: dbError } = await supabase
      .from("livros").insert([{ titulo, autor, descricao, tags, arquivo_url: publicUrl }])
    if (dbError) throw dbError

    fs.unlinkSync(filePath)
    res.json({ status: "ok", url: publicUrl })
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path)
    res.status(500).json({ status: "erro", message: err.message })
  }
})

// ── Editar livro ──
app.patch("/livros/:id", async (req, res) => {
  try {
    const { id } = req.params
    const { titulo, autor, descricao, tags: tagsRaw } = req.body
    const updates = {}
    if (titulo    !== undefined) updates.titulo    = titulo
    if (autor     !== undefined) updates.autor     = autor
    if (descricao !== undefined) updates.descricao = descricao
    if (tagsRaw   !== undefined)
      updates.tags = (tagsRaw.match(/#[\wÀ-ú]+/g) || []).map(t => t.slice(1).toLowerCase())

    if (!Object.keys(updates).length)
      return res.status(400).json({ status: "erro", message: "Nenhum campo para atualizar" })

    const { error } = await supabase.from("livros").update(updates).eq("id", id)
    if (error) throw error
    res.json({ status: "ok" })
  } catch (err) {
    res.status(500).json({ status: "erro", message: err.message })
  }
})

// ── Deletar livro ──
app.delete("/livros/:id", async (req, res) => {
  try {
    const { id } = req.params
    const { data: livro, error: fetchError } = await supabase
      .from("livros").select("arquivo_url").eq("id", id).single()
    if (fetchError) throw fetchError

    const fileName = livro.arquivo_url.split("/").pop()
    await supabase.storage.from("livros").remove([fileName])

    const { error: deleteError } = await supabase.from("livros").delete().eq("id", id)
    if (deleteError) throw deleteError

    res.json({ status: "ok" })
  } catch (err) {
    res.status(500).json({ status: "erro", message: err.message })
  }
})

// ── Buscar anotações do usuário para um livro ──
app.get("/anotacoes", async (req, res) => {
  const { user_id, livro_url } = req.query
  if (!user_id || !livro_url)
    return res.status(400).json({ status: "erro", message: "Parâmetros faltando" })

  try {
    const { data, error } = await supabase
      .from("anotacoes")
      .select("pagina, texto")
      .eq("user_id", user_id)
      .eq("livro_url", livro_url)

    if (error) throw error
    // Retorna como objeto { pagina: texto } para acesso O(1) no frontend
    const mapa = {}
    data.forEach(a => { mapa[a.pagina] = a.texto })
    res.json(mapa)
  } catch (err) {
    res.status(500).json({ status: "erro", message: err.message })
  }
})

// ── Salvar/atualizar anotação (upsert) ──
app.post("/anotacoes", async (req, res) => {
  const { user_id, livro_url, pagina, texto } = req.body
  if (!user_id || !livro_url || !pagina)
    return res.status(400).json({ status: "erro", message: "Parâmetros faltando" })

  try {
    if (!texto || !texto.trim()) {
      // Texto vazio = deletar a anotação
      const { error } = await supabase
        .from("anotacoes")
        .delete()
        .eq("user_id", user_id)
        .eq("livro_url", livro_url)
        .eq("pagina", pagina)
      if (error) throw error
    } else {
      // Upsert: cria ou atualiza
      const { error } = await supabase
        .from("anotacoes")
        .upsert({ user_id, livro_url, pagina, texto: texto.trim() },
                 { onConflict: "user_id,livro_url,pagina" })
      if (error) throw error
    }
    res.json({ status: "ok" })
  } catch (err) {
    res.status(500).json({ status: "erro", message: err.message })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`))
