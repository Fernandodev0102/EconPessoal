import os
from flask import Flask, render_template, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
import uuid
from datetime import datetime

# --- Configuração Inicial ---
app = Flask(__name__)

# Configuração do Banco de Dados
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///econfinancas.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Inicializa o SQLAlchemy (APENAS UMA VEZ AQUI)
db = SQLAlchemy(app)

# --- Modelos do Banco de Dados ---

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

    def to_dict(self):
        return {
            'id': self.id,
            'value': self.value,
            'date': self.date,
            'description': self.description,
            'payment_method': self.payment_method,
            'category': self.category_obj.name if self.category_obj else None,
            'category_id': self.category_id
        }

# --- Rotas ---

@app.route('/')
def index():
    return render_template('index.html')

# --- API Categorias ---

@app.route('/api/categories', methods=['GET', 'POST'])
def handle_categories():
    if request.method == 'GET':
        categories = Category.query.all()
        return jsonify([c.to_dict() for c in categories])
    elif request.method == 'POST':
        data = request.get_json()
        name = data.get('name')
        if not name: return jsonify({'error': 'Nome necessário'}), 400
        if Category.query.filter_by(name=name).first():
            return jsonify({'error': 'Categoria já existe'}), 409
        
        new_category = Category(name=name)
        db.session.add(new_category)
        db.session.commit()
        return jsonify(new_category.to_dict()), 201

@app.route('/api/categories/<int:category_id>', methods=['PUT', 'DELETE'])
def handle_category(category_id):
    category = Category.query.get(category_id)
    if not category: return jsonify({'error': 'Não encontrado'}), 404

    if request.method == 'PUT':
        data = request.get_json()
        category.name = data.get('name', category.name)
        db.session.commit()
        return jsonify(category.to_dict())

    elif request.method == 'DELETE':
        default_cat = Category.query.filter_by(name='Outros').first()
        if not default_cat:
            default_cat = Category(name='Outros')
            db.session.add(default_cat)
            db.session.commit()
        
        # Move gastos para "Outros"
        Expense.query.filter_by(category_id=category.id).update({'category_id': default_cat.id})
        db.session.delete(category)
        db.session.commit()
        return jsonify({'message': 'Deletado'}), 200

# --- API Gastos ---

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

        cat = Category.query.filter_by(name=data['category']).first()
        if not cat:
             # Cria categoria padrão se não existir na hora de salvar o gasto (segurança)
            default = Category.query.filter_by(name='Outros').first()
            if not default:
                default = Category(name='Outros')
                db.session.add(default)
                db.session.commit()
            cat = default

        new_expense = Expense(
            value=float(data['value']),
            date=data['date'],
            description=data.get('description'),
            payment_method=data['payment_method'],
            category_id=cat.id
        )
        db.session.add(new_expense)
        db.session.commit()
        return jsonify(new_expense.to_dict()), 201

@app.route('/api/expenses/<string:expense_id>', methods=['PUT', 'DELETE'])
def handle_expense_id(expense_id):
    expense = Expense.query.get(expense_id)
    if not expense: return jsonify({'error': 'Gasto não encontrado'}), 404

    if request.method == 'PUT':
        data = request.get_json()
        expense.value = float(data.get('value', expense.value))
        expense.date = data.get('date', expense.date)
        expense.description = data.get('description', expense.description)
        expense.payment_method = data.get('payment_method', expense.payment_method)
        
        if 'category' in data:
            cat = Category.query.filter_by(name=data['category']).first()
            if cat: expense.category_id = cat.id
            
        db.session.commit()
        return jsonify(expense.to_dict())

    elif request.method == 'DELETE':
        db.session.delete(expense)
        db.session.commit()
        return jsonify({'message': 'Deletado'}), 200

@app.route('/api/reset_data', methods=['DELETE'])
def reset_data():
    try:
        db.session.query(Expense).delete()
        db.session.commit()
        return jsonify({'message': 'Resetado'}), 200
    except:
        return jsonify({'error': 'Erro ao resetar'}), 500

# --- INICIALIZAÇÃO DO SISTEMA ---
if __name__ == '__main__':
    with app.app_context():
        # Cria as tabelas se não existirem
        db.create_all()
        
        # Cria categorias padrão automaticamente
        if not Category.query.first():
            print("Criando categorias padrão...")
            padroes = ['Alimentação', 'Transporte', 'Lazer', 'Moradia', 'Saúde', 'Educação', 'Outros']
            for nome in padroes:
                if not Category.query.filter_by(name=nome).first():
                    db.session.add(Category(name=nome))
            db.session.commit()
            print("Categorias criadas!")

    app.run(debug=True)