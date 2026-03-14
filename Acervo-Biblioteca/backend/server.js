const express = require("express")
const multer = require("multer")
const cors = require("cors")

const app = express()

app.use(cors())
app.use(express.json())

const upload = multer()

const GITHUB_TOKEN = process.env.GITHUB_TOKEN

const OWNER = "SEU_USUARIO_GITHUB"
const REPO = "SEU_REPOSITORIO"
const BRANCH = "main"

app.post("/addLivro", upload.single("capa"), async (req,res)=>{

try{

const titulo = req.body.titulo
const file = req.file

const base64 = file.buffer.toString("base64")

const path = `uploads/${Date.now()}-${file.originalname}`

const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`

await fetch(url,{
method:"PUT",
headers:{
Authorization:`token ${GITHUB_TOKEN}`,
"Content-Type":"application/json"
},
body:JSON.stringify({
message:`novo livro ${titulo}`,
content:base64,
branch:BRANCH
})
})

res.json({
status:"ok",
capa:`https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${path}`
})

}catch(err){

console.error(err)
res.json({status:"erro"})

}

})

app.listen(process.env.PORT || 3000)
