const express = require("express")
const multer = require("multer")
const fs = require("fs")
const cors = require("cors")
const { createClient } = require("@supabase/supabase-js")

const app = express()

app.use(cors())
app.use(express.json())

// configuração Supabase
const SUPABASE_URL = process.env.https://iwggwgepwbrvmmrgsrvr.supabase.co
const SUPABASE_KEY = process.env.eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3Z2d3Z2Vwd2Jydm1tcmdzcnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1Mzc4ODcsImV4cCI6MjA4OTExMzg4N30.BFaHUNavW7VOApg35r01SHsfjgYKUnhlT7YSADF9H6U

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// criar livros.json local se não existir
const livrosFile = "livros.json"
if (!fs.existsSync(livrosFile)) fs.writeFileSync(livrosFile, "[]")

// admin
const ADMIN_USER = "admin"
const ADMIN_PASS = "1234"

// multer para receber upload temporário
const upload = multer({ dest: "temp/" })

// rota teste
app.get("/", (req, res) => {
  res.json({ status: "API funcionando" })
})

// login
app.post("/login", (req, res) => {
  const { user, password } = req.body
  if (user === ADMIN_USER && password === ADMIN_PASS) {
    res.json({ status: "ok" })
  } else {
    res.json({ status: "erro" })
  }
})

// listar livros
app.get("/livros", (req, res) => {
  const livros = JSON.parse(fs.readFileSync(livrosFile))
  res.json(livros)
})

// adicionar livro
app.post("/addLivro", upload.single("capa"), async (req, res) => {
  try {
    const { titulo } = req.body
    const filePath = req.file.path
    const fileName = Date.now() + "-" + req.file.originalname

    // enviar para Supabase Storage
    const { data, error } = await supabase.storage
      .from("livros")
      .upload(fileName, fs.createReadStream(filePath), { upsert: true })

    if (error) throw error

    const publicUrl = supabase.storage.from("livros").getPublicUrl(fileName).data.publicUrl

    // salvar referência no JSON
    const livros = JSON.parse(fs.readFileSync(livrosFile))
    livros.push({ titulo, capa: publicUrl })
    fs.writeFileSync(livrosFile, JSON.stringify(livros, null, 2))

    // remover arquivo temporário
    fs.unlinkSync(filePath)

    res.json({ status: "ok" })
  } catch (err) {
    console.error(err)
    res.json({ status: "erro", message: err.message })
  }
})

// porta do render
const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Servidor rodando na porta " + PORT))
