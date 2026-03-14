async function login(){

const user=document.getElementById("user").value
const pass=document.getElementById("pass").value

const res=await fetch("https://edischinho-github-io.onrender.com/login",{
method:"POST",
headers:{
"Content-Type":"application/json"
},
body:JSON.stringify({user,pass})
})

const data=await res.json()

if(data.ok){
window.location="admin.html"
}else{
alert("Login incorreto")
}

}
