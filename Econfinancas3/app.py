import os
import uuid
import calendar
from datetime import datetime, timedelta, date
from flask import Flask, request, jsonify, render_template
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import extract

app = Flask(__name__)

# CONFIGURAÇÃO
basedir = os.path.abspath(os.path.dirname(__file__))
instance_path = os.path.join(basedir, 'instance')
if not os.path.exists(instance_path): os.makedirs(instance_path)
db_path = os.path.join(instance_path, 'econfinancas.db')
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + db_path
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# UTILITÁRIOS
def add_months(source_date, months):
    month = source_date.month - 1 + months
    year = source_date.year + month // 12
    month = month % 12 + 1
    day = min(source_date.day, calendar.monthrange(year, month)[1])
    return source_date.replace(year=year, month=month, day=day)

def calculate_cycle(expense, card=None):
    """Define se o gasto pertence ao ciclo 15 ou 30"""
    cycle = 30 # Default
    
    # Determina tipo do cartão se passado
    c_type = card.card_type if card else None
    c_due = card.due_day if card else None

    # É Crédito?
    is_truly_credit = ('Crédito' in expense.payment_method) or (c_type == 'CREDIT')

    if is_truly_credit:
        # Regra Crédito: Vencimento <= 15 -> Ciclo 15
        if c_due and int(c_due) <= 15: cycle = 15
        else: cycle = 30
    else:
        # Regra Débito: Compra dia <= 15 -> Ciclo 15
        if expense.date.day <= 15: cycle = 15
        else: cycle = 30
    return cycle

# MODELOS
class Category(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False, unique=True)

class BankAccount(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)
    cards = db.relationship('Card', backref='bank_account', lazy=True, cascade="all, delete-orphan")

class Card(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)
    card_type = db.Column(db.String(20), nullable=False) 
    limit = db.Column(db.Float, nullable=True)
    closing_day = db.Column(db.Integer, nullable=True)
    due_day = db.Column(db.Integer, nullable=True)
    bank_account_id = db.Column(db.Integer, db.ForeignKey('bank_account.id'), nullable=False)

class Expense(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    description = db.Column(db.String(100), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    date = db.Column(db.Date, nullable=False)
    category = db.Column(db.String(50), nullable=False)
    account_name = db.Column(db.String(100), nullable=False) 
    payment_method = db.Column(db.String(50), nullable=False) 
    bank_account_id = db.Column(db.Integer, db.ForeignKey('bank_account.id'), nullable=True)
    card_id = db.Column(db.Integer, db.ForeignKey('card.id'), nullable=True)
    is_credit_card = db.Column(db.Boolean, default=False)
    current_installment = db.Column(db.Integer, default=1)
    total_installments = db.Column(db.Integer, default=1)
    description_original = db.Column(db.String(100), nullable=True)
    group_id = db.Column(db.String(36), nullable=True)

# ROTAS
@app.route('/')
def index(): return render_template('index.html')

@app.route('/api/expenses', methods=['GET', 'POST'])
def handle_expenses():
    if request.method == 'GET':
        query = Expense.query
        cat = request.args.get('category')
        pay = request.args.get('payment_method')
        month_str = request.args.get('month') 
        cycle_filter = request.args.get('cycle')
        
        if cat: query = query.filter_by(category=cat)
        if pay:
            if pay == "Crédito": query = query.filter(Expense.payment_method.like('%Crédito%'))
            elif pay == "Vista": query = query.filter(Expense.payment_method.in_(['Pix', 'Débito', 'Dinheiro']))
            else: query = query.filter_by(payment_method=pay)
        if month_str:
            try:
                year, month = map(int, month_str.split('-'))
                query = query.filter(extract('year', Expense.date) == year, extract('month', Expense.date) == month)
            except: pass
            
        expenses_raw = query.order_by(Expense.date.desc()).all()
        output = []
        for e in expenses_raw:
            card_obj = Card.query.get(e.card_id) if e.card_id else None
            c_due = card_obj.due_day if card_obj else None
            
            # Usa a função unificada
            expense_cycle = calculate_cycle(e, card_obj)
            
            if cycle_filter and str(expense_cycle) != str(cycle_filter): continue 

            output.append({
                'id': e.id, 'description': e.description, 'amount': e.amount,
                'date': str(e.date), 'category': e.category, 
                'account': e.account_name, 'payment_method': e.payment_method,
                'current_installment': e.current_installment, 'total_installments': e.total_installments,
                'card_id': e.card_id, 'bank_account_id': e.bank_account_id, 
                'card_due_day': c_due, 'computed_cycle': expense_cycle
            })
        return jsonify(output)

    if request.method == 'POST':
        try:
            data = request.json
            base_date = datetime.strptime(data['date'], '%Y-%m-%d').date()
            card_id = data.get('card_id') if data.get('card_id') != "" else None
            bank_id = data.get('bank_account_id') if data.get('bank_account_id') != "" else None
            total_installments = int(data.get('total_installments', 1))
            total_amount = float(data['amount'])
            group_id = str(uuid.uuid4())
            installment_value = total_amount / total_installments
            
            start_offset = 0 
            if card_id:
                card = Card.query.get(card_id)
                if card and card.card_type == 'CREDIT' and card.closing_day:
                    if base_date.day >= card.closing_day: start_offset = 1
            
            for i in range(total_installments):
                this_date = add_months(base_date, i + start_offset)
                new_expense = Expense(
                    description=data['description'], amount=installment_value, date=this_date,
                    category=data['category'], account_name=data['account_name'],
                    payment_method=data['payment_method'], bank_account_id=bank_id,
                    card_id=card_id, is_credit_card=data.get('is_credit_card', False),
                    total_installments=total_installments, current_installment=i+1,
                    description_original=data['description'], group_id=group_id
                )
                db.session.add(new_expense)
            db.session.commit()
            return jsonify({'message': 'Salvo com sucesso!'}), 201
        except Exception as e: return jsonify({'error': str(e)}), 500

@app.route('/api/expenses/<id>', methods=['DELETE', 'PUT'])
def expense_ops(id):
    e = Expense.query.get(id)
    if not e: return jsonify({'error': '404'}), 404
    
    if request.method == 'DELETE':
        db.session.delete(e); db.session.commit()
        return jsonify({'message': 'Excluído'})
        
    if request.method == 'PUT':
        d = request.json
        try:
            e.description = d['description']
            e.amount = float(d['amount'])
            e.date = datetime.strptime(d['date'], '%Y-%m-%d').date()
            e.category = d['category']
            e.payment_method = d['payment_method']
            e.account_name = d['account_name']
            e.card_id = int(d['card_id']) if d.get('card_id') else None
            e.bank_account_id = int(d['bank_account_id']) if d.get('bank_account_id') else None
            e.total_installments = d.get('total_installments', 1)
            db.session.commit()
            return jsonify({'message': 'Ok'})
        except Exception as err: return jsonify({'error': str(err)}), 500

# --- ROTA NOVA: ENCERRAR CICLO ---
@app.route('/api/cycles/close/<int:cycle_day>', methods=['POST'])
def close_cycle_route(cycle_day):
    """
    Remove gastos do ciclo X (15 ou 30) que tenham data <= Hoje.
    Isso serve para 'limpar' o dashboard de gastos já passados/pagos.
    """
    today = date.today()
    all_expenses = Expense.query.filter(Expense.date <= today).all()
    
    deleted_count = 0
    for e in all_expenses:
        card_obj = Card.query.get(e.card_id) if e.card_id else None
        
        # Verifica se esse gasto pertence ao ciclo que estamos fechando
        if calculate_cycle(e, card_obj) == cycle_day:
            db.session.delete(e)
            deleted_count += 1
            
    db.session.commit()
    return jsonify({'message': f'Ciclo {cycle_day} encerrado! {deleted_count} gastos arquivados.'})

# --- ROTAS DE CONTAS, CARTÕES, CATEGORIAS (MANTIDAS IGUAIS) ---
@app.route('/api/accounts', methods=['GET', 'POST'])
def manage_accounts():
    if request.method == 'POST':
        db.session.add(BankAccount(name=request.json['name'])); db.session.commit()
        return jsonify({'msg': 'Ok'}), 201
    return jsonify([{'id': a.id, 'name': a.name, 'cards': [{'id':c.id, 'name':c.name, 'type':c.card_type, 'limit':c.limit, 'closing_day':c.closing_day, 'due_day':c.due_day} for c in a.cards]} for a in BankAccount.query.all()])

@app.route('/api/accounts/<int:id>', methods=['DELETE'])
def delete_account(id):
    db.session.delete(BankAccount.query.get(id)); db.session.commit()
    return jsonify({'msg': 'Ok'})

@app.route('/api/cards', methods=['POST'])
def create_card():
    d = request.json
    c = int(d['closing_day']) if d.get('closing_day') else None
    du = int(d['due_day']) if d.get('due_day') else None
    db.session.add(Card(name=d['name'], card_type=d['card_type'], limit=float(d.get('limit') or 0), closing_day=c, due_day=du, bank_account_id=int(d['bank_account_id'])))
    db.session.commit()
    return jsonify({'msg': 'Ok'}), 201

@app.route('/api/cards/<int:id>', methods=['DELETE'])
def delete_card(id):
    db.session.delete(Card.query.get(id)); db.session.commit()
    return jsonify({'msg': 'Ok'})

@app.route('/api/categories', methods=['GET', 'POST'])
def cats():
    if request.method=='POST':
        db.session.add(Category(name=request.json['name'])); db.session.commit()
        return jsonify({'msg':'ok'}), 201
    return jsonify([{'id':c.id, 'name':c.name} for c in Category.query.all()])

@app.route('/api/categories/<int:id>', methods=['DELETE', 'PUT'])
def cat_ops(id):
    c = Category.query.get(id)
    if request.method=='DELETE': db.session.delete(c)
    else: c.name = request.json['name']
    db.session.commit()
    return jsonify({'msg':'ok'})

with app.app_context():
    db.create_all()
    if not Category.query.first():
        for n in ["Alimentação", "Transporte", "Lazer", "Casa", "Educação", "Saúde", "Outros"]: db.session.add(Category(name=n))
        db.session.commit()

if __name__ == '__main__':
    app.run(debug=True)