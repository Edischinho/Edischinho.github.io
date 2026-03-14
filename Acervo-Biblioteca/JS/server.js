const express = require("express")
const multer = require("multer")
const fs = require("fs")
const cors = require("cors")

const app = express()

app.use(cors())
app.use(express.json())

if(!fs.existsSync("uploads")){
 fs.mkdirSync("uploads")
}

app.use("/uploads",express.static("uploads"))

const ADMIN_USER="admin"
const ADMIN_PASS="1234"

const storage = multer.diskStorage({
 destination:"uploads/",
 filename:(req,file,cb)=>{
  cb(null,Date.now()+"-"+file.originalname)
 }
})

const upload = multer({storage})

app.post("/login",(req,res)=>{

 const {user,password}=req.body

 if(user===ADMIN_USER && password===ADMIN_PASS){
  res.json({status:"ok"})
 }else{
  res.json({status:"erro"})
 }

})

app.get("/livros",(req,res)=>{

 let livros=JSON.parse(fs.readFileSync("livros.json"))
 res.json(livros)

})

app.post("/addLivro",upload.single("capa"),(req,res)=>{

 let livros=JSON.parse(fs.readFileSync("livros.json"))

 livros.push({
  titulo:req.body.titulo,
  capa:req.file.path
 })

 fs.writeFileSync("livros.json",JSON.stringify(livros,null,2))

 res.json({status:"ok"})

})

const PORT = process.env.PORT || 3000

app.listen(PORT,()=>{
 console.log("Servidor rodando")
})
