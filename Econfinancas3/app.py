import uuid
import os
from flask import Flask, request, jsonify, render_template
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

# --- CONFIGURAÇÃO "BLINDADA" DO BANCO DE DADOS ---
app = Flask(__name__)

# 1. Pega o caminho absoluto da pasta onde o app.py está
basedir = os.path.abspath(os.path.dirname(__file__))

# 2. Define onde a pasta 'instance' deve ficar
instance_path = os.path.join(basedir, 'instance')

# 3. CRIA A PASTA SE ELA NÃO EXISTIR (Isso resolve o problema de não criar o arquivo)
if not os.path.exists(instance_path):
    os.makedirs(instance_path)
    print(f"--> CRIANDO PASTA INSTANCE EM: {instance_path}")

# 4. Configura o banco de dados
db_path = os.path.join(instance_path, 'econfinancas.db')
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + db_path
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# 5. GARANTE QUE AS TABELAS EXISTEM ANTES DE RODAR
with app.app_context():
    db.create_all()
    print("-" * 50)
    print(f"--> BANCO DE DADOS PRONTO E CONECTADO:\n{db_path}")
    print("-" * 50)
# -------------------------------------------------

# ... (Mantenha o resto do seu código: class Expense, rotas @app.route, etc.) ...

# ==============================================================================
# FUNÇÕES AUXILIARES
# ==============================================================================
def add_months(source_date, months):
    """Calcula data futura para parcelamento, ajustando dias (ex: 31 -> 30)"""
    month = source_date.month - 1 + months
    year = source_date.year + month // 12
    month = month % 12 + 1
    day = min(source_date.day, [31,
        29 if year % 4 == 0 and not year % 100 == 0 or year % 400 == 0 else 28,
        31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month-1])
    return source_date.replace(year=year, month=month, day=day)

# ==============================================================================
# MODELOS (TABELAS DO BANCO)
# ==============================================================================

class Income(db.Model):
    """Tabela para armazenar as Rendas Fixas (Salários)"""
    id = db.Column(db.Integer, primary_key=True)
    income_15 = db.Column(db.Float, default=0.0)
    income_30 = db.Column(db.Float, default=0.0)

    def to_dict(self):
        return {'income_15': self.income_15, 'income_30': self.income_30}

class Category(db.Model):
    """Tabela de Categorias"""
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), unique=True, nullable=False)
    expenses = db.relationship('Expense', backref='category_obj', lazy=True)

    def to_dict(self):
        return {'id': self.id, 'name': self.name}

class Expense(db.Model):
    """Tabela Principal de Gastos"""
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    value = db.Column(db.Float, nullable=False)
    date = db.Column(db.String(10), nullable=False)
    description = db.Column(db.String(200), nullable=True)
    payment_method = db.Column(db.String(50), nullable=False, default='Outros')
    category_id = db.Column(db.Integer, db.ForeignKey('category.id'), nullable=False)
    paid = db.Column(db.Boolean, default=True, nullable=False)
    cycle = db.Column(db.Integer, nullable=False, default=15) 

    def to_dict(self):
        return {
            'id': self.id,
            'value': self.value,
            'date': self.date,
            'description': self.description,
            'payment_method': self.payment_method,
            'paid': self.paid,
            'cycle': self.cycle,
            'category': self.category_obj.name if self.category_obj else None,
            'category_id': self.category_id
        }

# ==============================================================================
# ROTAS PRINCIPAIS
# ==============================================================================
@app.route('/')
def index():
    return render_template('index.html')

# --- RENDA ---
@app.route('/api/income', methods=['GET', 'POST'])
def handle_income():
    income = Income.query.first()
    if not income:
        income = Income(income_15=0.0, income_30=0.0)
        db.session.add(income)
        db.session.commit()

    if request.method == 'GET':
        return jsonify(income.to_dict())
    
    elif request.method == 'POST':
        data = request.get_json()
        income.income_15 = float(data.get('income_15', income.income_15))
        income.income_30 = float(data.get('income_30', income.income_30))
        db.session.commit()
        return jsonify(income.to_dict())

# --- CATEGORIAS ---
@app.route('/api/categories', methods=['GET', 'POST'])
def handle_categories():
    if request.method == 'GET':
        return jsonify([c.to_dict() for c in Category.query.all()])
    elif request.method == 'POST':
        data = request.get_json()
        if not data.get('name'): return jsonify({'error': 'Nome necessário'}), 400
        if Category.query.filter_by(name=data['name']).first():
            return jsonify({'error': 'Categoria já existe'}), 409
        new_cat = Category(name=data['name'])
        db.session.add(new_cat)
        db.session.commit()
        return jsonify(new_cat.to_dict()), 201

@app.route('/api/categories/<int:id>', methods=['DELETE'])
def delete_category(id):
    cat = Category.query.get(id)
    if not cat: return jsonify({'error': 'Não encontrado'}), 404
    default = Category.query.filter_by(name='Outros').first()
    if not default:
        default = Category(name='Outros')
        db.session.add(default)
        db.session.commit()
    Expense.query.filter_by(category_id=cat.id).update({'category_id': default.id})
    db.session.delete(cat)
    db.session.commit()
    return jsonify({'message': 'Deletado'}), 200

# --- GASTOS (CRUD) ---
@app.route('/api/expenses', methods=['GET', 'POST'])
def handle_expenses():
    if request.method == 'GET':
        query = Expense.query
        if request.args.get('category'):
            cat = Category.query.filter_by(name=request.args.get('category')).first()
            if cat: query = query.filter_by(category_id=cat.id)
        if request.args.get('date'):
            query = query.filter_by(date=request.args.get('date'))
        return jsonify([e.to_dict() for e in query.order_by(Expense.date.desc()).all()])

    elif request.method == 'POST':
        data = request.get_json()
        if not all(k in data for k in ('value', 'date', 'category', 'payment_method')):
            return jsonify({'error': 'Dados incompletos'}), 400

        raw_value = float(data['value'])
        raw_date_str = data['date']
        raw_date = datetime.strptime(raw_date_str, '%Y-%m-%d')
        installments = int(data.get('installments', 1))
        description = data.get('description', '')
        payment_method = data['payment_method']
        cycle = int(data.get('cycle', 15)) 

        cat = Category.query.filter_by(name=data['category']).first()
        if not cat:
            default = Category.query.filter_by(name='Outros').first() or Category(name='Outros')
            db.session.add(default)
            db.session.commit()
            cat = default

        expenses_to_add = []

        if installments > 1:
            installment_value = raw_value / installments
            for i in range(installments):
                current_date = add_months(raw_date, i)
                date_str = current_date.strftime('%Y-%m-%d')
                desc_parcela = f"{description} ({i+1}/{installments})"
                is_paid = False if 'Crédito' in payment_method else True
                
                new_expense = Expense(
                    value=installment_value,
                    date=date_str,
                    description=desc_parcela,
                    payment_method=payment_method,
                    paid=is_paid,
                    cycle=cycle,
                    category_id=cat.id
                )
                expenses_to_add.append(new_expense)
        else:
            is_paid = False if 'Crédito' in payment_method else True
            new_expense = Expense(
                value=raw_value,
                date=raw_date_str,
                description=description,
                payment_method=payment_method,
                paid=is_paid,
                cycle=cycle,
                category_id=cat.id
            )
            expenses_to_add.append(new_expense)

        for exp in expenses_to_add:
            db.session.add(exp)
        
        db.session.commit()
        return jsonify(expenses_to_add[0].to_dict()), 201

@app.route('/api/expenses/<string:id>', methods=['PUT', 'DELETE'])
def handle_expense_id(id):
    expense = Expense.query.get(id)
    if not expense: return jsonify({'error': 'Não encontrado'}), 404

    if request.method == 'PUT':
        data = request.get_json()
        expense.value = float(data.get('value', expense.value))
        expense.date = data.get('date', expense.date)
        expense.description = data.get('description', expense.description)
        expense.cycle = int(data.get('cycle', expense.cycle))

        if 'payment_method' in data:
            expense.payment_method = data['payment_method']
            if 'Crédito' in expense.payment_method:
                expense.paid = False 
            else:
                expense.paid = True

        if 'category' in data:
            cat = Category.query.filter_by(name=data['category']).first()
            if cat: expense.category_id = cat.id
            
        db.session.commit()
        return jsonify(expense.to_dict())

    elif request.method == 'DELETE':
        db.session.delete(expense)
        db.session.commit()
        return jsonify({'message': 'Deletado'}), 200

@app.route('/api/expenses/<string:id>/toggle_paid', methods=['PATCH'])
def toggle_paid(id):
    expense = Expense.query.get(id)
    if not expense: return jsonify({'error': 'Não encontrado'}), 404
    expense.paid = not expense.paid
    db.session.commit()
    return jsonify(expense.to_dict())

# ==============================================================================
# NOVA ROTA: ENCERRAR CICLO (PROTEGENDO PARCELAS FUTURAS)
# ==============================================================================
@app.route('/api/cycles/close/<int:cycle_id>', methods=['DELETE'])
def close_cycle(cycle_id):
    try:
        # Pega a data de hoje
        today = datetime.now().strftime('%Y-%m-%d')
        
        # LÓGICA DE OURO:
        # Apaga apenas gastos DESTE CICLO (15 ou 30)
        # E que tenham data MENOR ou IGUAL a hoje.
        # Isso apaga o passado/presente, mas MANTÉM as parcelas futuras (meses seguintes).
        
        deleted_count = Expense.query.filter(
            Expense.cycle == cycle_id,
            Expense.date <= today
        ).delete()
        
        db.session.commit()
        return jsonify({'message': f'Ciclo {cycle_id} encerrado. {deleted_count} itens arquivados.'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/reset_data', methods=['DELETE'])
def reset_data():
    try:
        db.session.query(Expense).delete()
        db.session.commit()
        return jsonify({'message': 'Resetado'}), 200
    except: return jsonify({'error': 'Erro'}), 500

# --- EXPORTAÇÃO ---
@app.route('/api/export_csv')
def export_csv():
    expenses = Expense.query.order_by(Expense.date.desc()).all()
    output = io.StringIO()
    writer = csv.writer(output, delimiter=';', quoting=csv.QUOTE_MINIMAL)
    writer.writerow(['Data', 'Descrição', 'Categoria', 'Valor (R$)', 'Pagamento', 'Ciclo', 'Status'])

    for exp in expenses:
        date_obj = datetime.strptime(exp.date, '%Y-%m-%d')
        date_br = date_obj.strftime('%d/%m/%Y')
        value_br = f"{exp.value:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')
        status = "Pago" if exp.paid else "Pendente"
        cycle_label = f"Dia {exp.cycle}"
        writer.writerow([date_br, exp.description, exp.category_obj.name, value_br, exp.payment_method, cycle_label, status])

    return Response(
        output.getvalue().encode('utf-8-sig'),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment;filename=meus_gastos.csv"}
    )

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        # Garante dados iniciais
        if not Category.query.first():
            padroes = ['Alimentação', 'Transporte', 'Lazer', 'Moradia', 'Saúde', 'Educação', 'Outros']
            for nome in padroes:
                if not Category.query.filter_by(name=nome).first():
                    db.session.add(Category(name=nome))
            db.session.commit()
        if not Income.query.first():
            db.session.add(Income(income_15=0.0, income_30=0.0))
            db.session.commit()
    app.run(debug=True)