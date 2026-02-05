import os
from flask import Flask, render_template, request, jsonify
from flask_sqlalchemy import SQLAlchemy
import uuid
from datetime import datetime

app = Flask(__name__)

# Configuração do Banco de Dados
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///econfinancas.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# --- FUNÇÃO AUXILIAR PARA DATAS (PARCELAMENTO) ---
def add_months(source_date, months):
    month = source_date.month - 1 + months
    year = source_date.year + month // 12
    month = month % 12 + 1
    day = min(source_date.day, [31,
        29 if year % 4 == 0 and not year % 100 == 0 or year % 400 == 0 else 28,
        31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month-1])
    return source_date.replace(year=year, month=month, day=day)

# --- MODELOS ---
class Category(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), unique=True, nullable=False)
    expenses = db.relationship('Expense', backref='category_obj', lazy=True)

    def to_dict(self):
        return {'id': self.id, 'name': self.name}

class Expense(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    value = db.Column(db.Float, nullable=False)
    date = db.Column(db.String(10), nullable=False)
    description = db.Column(db.String(200), nullable=True)
    payment_method = db.Column(db.String(50), nullable=False, default='Outros')
    category_id = db.Column(db.Integer, db.ForeignKey('category.id'), nullable=False)
    paid = db.Column(db.Boolean, default=True, nullable=False)

    def to_dict(self):
        return {
            'id': self.id,
            'value': self.value,
            'date': self.date,
            'description': self.description,
            'payment_method': self.payment_method,
            'paid': self.paid,
            'category': self.category_obj.name if self.category_obj else None,
            'category_id': self.category_id
        }

# --- ROTAS DE NAVEGAÇÃO ---
@app.route('/')
def index():
    return render_template('index.html')

# --- API CATEGORIAS ---
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

# --- API GASTOS ---
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
        
        # Validação básica
        if not all(k in data for k in ('value', 'date', 'category', 'payment_method')):
            return jsonify({'error': 'Dados incompletos'}), 400

        # Recupera dados
        raw_value = float(data['value'])
        raw_date_str = data['date']
        raw_date = datetime.strptime(raw_date_str, '%Y-%m-%d')
        installments = int(data.get('installments', 1))
        description = data.get('description', '')
        payment_method = data['payment_method']

        # Busca ou Cria Categoria
        cat = Category.query.filter_by(name=data['category']).first()
        if not cat:
            default = Category.query.filter_by(name='Outros').first() or Category(name='Outros')
            db.session.add(default)
            db.session.commit()
            cat = default

        # LÓGICA DE PARCELAMENTO E STATUS
        expenses_to_add = []

        if installments > 1:
            installment_value = raw_value / installments
            for i in range(installments):
                # Calcula data futura
                current_date = add_months(raw_date, i)
                date_str = current_date.strftime('%Y-%m-%d')
                
                # Descrição ex: "Notebook (1/10)"
                desc_parcela = f"{description} ({i+1}/{installments})"
                
                # Crédito nasce Pendente (False), Outros nascem Pagos (True)
                is_paid = False if payment_method == 'Crédito' else True
                
                new_expense = Expense(
                    value=installment_value,
                    date=date_str,
                    description=desc_parcela,
                    payment_method=payment_method,
                    paid=is_paid,
                    category_id=cat.id
                )
                expenses_to_add.append(new_expense)
        else:
            # Compra à vista (1x)
            is_paid = False if payment_method == 'Crédito' else True
            new_expense = Expense(
                value=raw_value,
                date=raw_date_str,
                description=description,
                payment_method=payment_method,
                paid=is_paid,
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
        
        # Atualiza status se mudar método
        if 'payment_method' in data:
            expense.payment_method = data['payment_method']
            # Se virou crédito, fica pendente. Se saiu de crédito, fica pago.
            if expense.payment_method == 'Crédito':
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

@app.route('/api/reset_data', methods=['DELETE'])
def reset_data():
    try:
        db.session.query(Expense).delete()
        db.session.commit()
        return jsonify({'message': 'Resetado'}), 200
    except: return jsonify({'error': 'Erro'}), 500

# --- INICIALIZAÇÃO ---
if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        # Categorias Padrão
        if not Category.query.first():
            padroes = ['Alimentação', 'Transporte', 'Lazer', 'Moradia', 'Saúde', 'Educação', 'Outros']
            for nome in padroes:
                if not Category.query.filter_by(name=nome).first():
                    db.session.add(Category(name=nome))
            db.session.commit()
    app.run(debug=True)