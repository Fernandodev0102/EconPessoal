from app import app, db

print("--> Conectando ao app...")
with app.app_context():
    print("--> Criando tabelas no banco de dados...")
    db.create_all()
    print("--> SUCESSO! As tabelas foram criadas.")
    print("--> Agora voce pode abrir o app e salvar gastos.")

input("Pressione ENTER para sair...")