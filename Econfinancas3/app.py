import os
import uuid
import calendar
from datetime import datetime, timedelta, date
from flask import Flask, request, jsonify, render_template
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import extract, func

app = Flask(__name__)

# Configuração do Banco de Dados
basedir = os.path.abspath(os.path.dirname(__file__))
instance_path = os.path.join(basedir, 'instance')
if not os.path.exists(instance_path): os.makedirs(instance_path)
db_path = os.path.join(instance_path, 'econfinancas.db')
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + db_path
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# --- UTILITÁRIOS ---
def add_months(source_date, months):
    month = source_date.month - 1 + months
    year = source_date.year + month // 12
    month = month % 12 + 1
    day = min(source_date.day, calendar.monthrange(year, month)[1])
    return source_date.replace(year=year, month=month, day=day)

# --- MODELOS (BD) ---
class Category(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False, unique=True)

class BankAccount(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)
    current_balance = db.Column(db.Float, default=0.0)
    color = db.Column(db.String(20), default='#00e676') 
    cards = db.relationship('Card', backref='bank_account', lazy=True, cascade="all, delete-orphan")

class Card(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)
    card_type = db.Column(db.String(20), nullable=False) 
    limit = db.Column(db.Float, nullable=True)
    closing_day = db.Column(db.Integer, nullable=True)
    due_day = db.Column(db.Integer, nullable=True)
    bank_account_id = db.Column(db.Integer, db.ForeignKey('bank_account.id'), nullable=False)

class FixedExpense(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    due_day = db.Column(db.Integer, nullable=False)

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
    status = db.Column(db.String(20), default='OPEN')
    # NOVO CAMPO: Para saber para onde o dinheiro foi numa transferência
    transfer_dest_id = db.Column(db.Integer, nullable=True)

# --- ROTAS PRINCIPAIS ---
@app.route('/')
def index(): return render_template('index.html')

# --- ROTA DE EMERGÊNCIA (RESETAR BANCO) ---
@app.route('/reset-force')
def reset_force():
    try:
        db.drop_all()
        db.create_all()
        if not Category.query.first():
            for n in ["Alimentação", "Transporte", "Lazer", "Casa", "Educação", "Saúde", "Outros", "Pagamento de Fatura", "Transferência"]: 
                db.session.add(Category(name=n))
            db.session.commit()
        return "<h1>Sistema Resetado!</h1><p>Banco atualizado com suporte a estorno de transferências.</p>"
    except Exception as e:
        return f"Erro ao resetar: {str(e)}"

# --- GASTOS FIXOS ---
@app.route('/api/fixed_expenses', methods=['GET', 'POST'])
def handle_fixed():
    if request.method == 'POST':
        d = request.json
        db.session.add(FixedExpense(name=d['name'], amount=float(d['amount']), due_day=int(d['due_day'])))
        db.session.commit()
        return jsonify({'msg':'ok'})
    return jsonify([{ 'id': f.id, 'name': f.name, 'amount': f.amount, 'due_day': f.due_day } for f in FixedExpense.query.all()])

@app.route('/api/fixed_expenses/<int:id>', methods=['DELETE'])
def delete_fixed(id):
    db.session.delete(FixedExpense.query.get(id))
    db.session.commit()
    return jsonify({'msg':'ok'})

# --- DASHBOARD DE CICLOS INTELIGENTE ---
# --- DASHBOARD DE CICLOS INTELIGENTE (ATUALIZADO: Ignora Transferências) ---
@app.route('/api/dashboard/cycles_projection', methods=['GET'])
def cycles_projection():
    today = date.today()
    c15 = {'cards': 0.0, 'fixed': 0.0, 'others': 0.0, 'total': 0.0}
    c30 = {'cards': 0.0, 'fixed': 0.0, 'others': 0.0, 'total': 0.0}
    
    # 1. Cartões
    cards = Card.query.filter_by(card_type='CREDIT').all()
    for card in cards:
        invoice_val = db.session.query(func.sum(Expense.amount))\
            .filter(Expense.card_id == card.id, Expense.status == 'OPEN', Expense.date <= today).scalar() or 0.0
        
        if invoice_val > 0:
            day = card.due_day
            if 15 <= day <= 29: c15['cards'] += invoice_val
            else: c30['cards'] += invoice_val

    # 2. Fixos
    fixeds = FixedExpense.query.all()
    for f in fixeds:
        if 15 <= f.due_day <= 29: c15['fixed'] += f.amount
        else: c30['fixed'] += f.amount

    # 3. Variáveis Abertos (Ignora Transferências agora)
    others = Expense.query.filter(
        Expense.status == 'OPEN', 
        Expense.is_credit_card == False, 
        Expense.category != 'Transferência', # <--- AQUI: Não soma transferência na projeção
        Expense.date <= today
    ).all()

    for o in others:
        day = o.date.day
        if 15 <= day <= 29: c15['others'] += o.amount
        else: c30['others'] += o.amount

    c15['total'] = c15['cards'] + c15['fixed'] + c15['others']
    c30['total'] = c30['cards'] + c30['fixed'] + c30['others']
    return jsonify({'cycle_15': c15, 'cycle_30': c30})
# --- EXPENSES CRUD ---
# --- EXPENSES CRUD (CORRIGIDO: Status Dinâmico) ---
@app.route('/api/expenses', methods=['GET', 'POST'])
def handle_expenses():
    if request.method == 'GET':
        query = Expense.query
        cat = request.args.get('category')
        pay = request.args.get('payment_method')
        month_str = request.args.get('month') 
        source_filter = request.args.get('source') 
        
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
        if source_filter:
            if source_filter.startswith('ACC-'): query = query.filter(Expense.bank_account_id == int(source_filter.split('-')[1]))
            elif source_filter.startswith('CARD-'): query = query.filter(Expense.card_id == int(source_filter.split('-')[1]))

        expenses_raw = query.order_by(Expense.date.desc()).all()
        output = []
        for e in expenses_raw:
            cycle_view = 30
            day_ref = e.date.day
            if e.card_id:
                c = Card.query.get(e.card_id)
                if c and c.due_day: day_ref = c.due_day
            if 15 <= day_ref <= 29: cycle_view = 15

            output.append({
                'id': e.id, 'description': e.description, 'amount': e.amount,
                'date': str(e.date), 'category': e.category, 
                'account': e.account_name, 'payment_method': e.payment_method,
                'current_installment': e.current_installment, 'total_installments': e.total_installments,
                'card_id': e.card_id, 'bank_account_id': e.bank_account_id, 
                'computed_cycle': cycle_view,
                'status': e.status
            })
        return jsonify(output)

    if request.method == 'POST':
        try:
            data = request.json
            base_date = datetime.strptime(data['date'], '%Y-%m-%d').date()
            card_id = int(data['card_id']) if data.get('card_id') else None
            bank_id = int(data['bank_account_id']) if data.get('bank_account_id') else None
            total_installments = int(data.get('total_installments', 1))
            total_amount = float(data['amount'])
            group_id = str(uuid.uuid4())
            installment_value = total_amount / total_installments
            start_offset = 0 
            
            # DEFINE O STATUS CORRETO
            final_status = 'OPEN' # Padrão
            
            if card_id:
                # Se tem cartão de crédito, é OPEN (esperando fatura)
                card = Card.query.get(card_id)
                final_status = 'OPEN' 
                if card:
                    if card.card_type == 'CREDIT' and card.closing_day:
                        if base_date.day >= card.closing_day: start_offset = 1
                    
                    if card.limit is not None and card.limit < total_amount:
                        return jsonify({'error': f'Limite insuficiente! Disponível: R$ {card.limit:.2f}'}), 400
                    card.limit -= total_amount
            elif bank_id:
                # Se é conta bancária (Débito/Pix), é CLOSED (pago na hora)
                final_status = 'CLOSED'
                b = BankAccount.query.get(bank_id)
                if b:
                    if b.current_balance < total_amount:
                        return jsonify({'error': f'Saldo insuficiente! Disponível: R$ {b.current_balance:.2f}'}), 400
                    b.current_balance -= total_amount

            for i in range(total_installments):
                this_date = add_months(base_date, i + start_offset)
                new_expense = Expense(
                    description=data['description'], amount=installment_value, date=this_date,
                    category=data['category'], account_name=data['account_name'],
                    payment_method=data['payment_method'], bank_account_id=bank_id,
                    card_id=card_id, is_credit_card=data.get('is_credit_card', False),
                    total_installments=total_installments, current_installment=i+1,
                    description_original=data['description'], group_id=group_id,
                    status=final_status # <--- AQUI APLICAMOS O STATUS DECIDIDO ACIMA
                )
                db.session.add(new_expense)
            db.session.commit()
            return jsonify({'message': 'Salvo com sucesso!'}), 201
        except Exception as e:
            db.session.rollback()
            return jsonify({'error': str(e)}), 500
# --- ROTA DE DELETE E UPDATE (COM LÓGICA DE ESTORNO DE TRANSFERÊNCIA) ---
@app.route('/api/expenses/<id>', methods=['DELETE', 'PUT'])
def expense_ops(id):
    e = Expense.query.get(id)
    if not e: return jsonify({'error': '404'}), 404
    
    if request.method == 'DELETE':
        try:
            scope = request.args.get('scope', 'single')
            expenses_to_delete = []
            
            if scope == 'all' and e.group_id:
                expenses_to_delete = Expense.query.filter_by(group_id=e.group_id).all()
            else:
                expenses_to_delete = [e]

            for item in expenses_to_delete:
                # 1. Devolução Padrão (Origem)
                if item.card_id:
                    c = Card.query.get(item.card_id)
                    if c and c.limit is not None: c.limit += item.amount
                elif item.bank_account_id:
                    b = BankAccount.query.get(item.bank_account_id)
                    if b: b.current_balance += item.amount
                
                # 2. LÓGICA DE ESTORNO DE TRANSFERÊNCIA (Destino)
                # Se for transferência, temos que TIRAR o dinheiro de quem recebeu
                if item.transfer_dest_id:
                    dest_acc = BankAccount.query.get(item.transfer_dest_id)
                    if dest_acc:
                        dest_acc.current_balance -= item.amount

                db.session.delete(item)
            
            db.session.commit()
            return jsonify({'message': 'Excluído(s) com sucesso'})
        except Exception as err:
            db.session.rollback(); return jsonify({'error': str(err)}), 500
        
    if request.method == 'PUT':
        d = request.json
        try:
            new_amount = float(d['amount'])
            
            # Validações e ajustes básicos
            if e.bank_account_id:
                b = BankAccount.query.get(e.bank_account_id)
                diff = new_amount - e.amount
                if b and b.current_balance < diff:
                     return jsonify({'error': 'Saldo insuficiente para atualizar'}), 400
                b.current_balance -= diff

            if e.card_id:
                c = Card.query.get(e.card_id)
                diff = new_amount - e.amount
                if c and c.limit is not None:
                    if c.limit < diff: return jsonify({'error': 'Limite insuficiente'}), 400
                    c.limit -= diff

            e.description = d['description']
            e.amount = new_amount
            e.category = d['category']
            e.date = datetime.strptime(d['date'], '%Y-%m-%d').date()
            e.payment_method = d['payment_method']
            
            db.session.commit()
            return jsonify({'message': 'Ok'})
        except Exception as err: 
            db.session.rollback(); return jsonify({'error': str(err)}), 500

# --- TRANSFERÊNCIA BANCÁRIA (BLINDADA) ---
@app.route('/api/transfers', methods=['POST'])
def transfer_balance():
    try:
        data = request.json
        source_id = int(data['source_id'])
        dest_id = int(data['dest_id'])
        amount = float(data['amount'])
        date_str = data['date']
        
        if source_id == dest_id: return jsonify({'error': 'Origem e Destino iguais'}), 400
        if amount <= 0: return jsonify({'error': 'Valor inválido'}), 400

        source_acc = BankAccount.query.get(source_id)
        dest_acc = BankAccount.query.get(dest_id)

        if not source_acc or not dest_acc: return jsonify({'error': 'Conta não encontrada'}), 404
        if source_acc.current_balance < amount: return jsonify({'error': 'Saldo Insuficiente'}), 400

        # Movimentação
        source_acc.current_balance -= amount
        dest_acc.current_balance += amount

        cat_transfer = Category.query.filter_by(name="Transferência").first()
        if not cat_transfer:
            db.session.add(Category(name="Transferência"))
            db.session.commit()

        payment_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        
        # Cria Log salvando o Destino para estorno futuro
        log_expense = Expense(
            description=f"Transf. para {dest_acc.name}",
            amount=amount,
            date=payment_date,
            category="Transferência",
            account_name=source_acc.name,
            payment_method="Pix",
            bank_account_id=source_acc.id,
            card_id=None,
            is_credit_card=False,
            status='CLOSED',
            transfer_dest_id=dest_id # <--- AQUI ESTÁ O SEGREDO
        )
        
        db.session.add(log_expense)
        db.session.commit()
        return jsonify({'message': 'Sucesso!'})
    except Exception as e:
        db.session.rollback(); return jsonify({'error': str(e)}), 500

# --- PAGAR FATURA ---
# --- PAGAR FATURA (CORRIGIDO: Mantém vínculo com o cartão para o Ciclo Certo) ---
@app.route('/api/cards/pay_invoice', methods=['POST'])
def pay_invoice():
    try:
        data = request.json
        card_id = int(data['card_id'])
        bank_id = int(data['bank_account_id'])
        amount_to_pay = float(data['amount'])
        date_str = data['date']
        
        card = Card.query.get(card_id)
        bank = BankAccount.query.get(bank_id)
        
        if not card or not bank: return jsonify({'error': 'Erro de dados'}), 404
        payment_date = datetime.strptime(date_str, '%Y-%m-%d').date()

        # Calcula dívida
        real_debt = db.session.query(func.sum(Expense.amount)).filter(Expense.card_id == card.id, Expense.status == 'OPEN', Expense.date <= payment_date).scalar() or 0.0
        real_debt = round(real_debt, 2)
        amount_to_pay = round(amount_to_pay, 2)

        if amount_to_pay > (real_debt + 0.01): return jsonify({'error': f'Máximo: R$ {real_debt:.2f}'}), 400
        if bank.current_balance < amount_to_pay: return jsonify({'error': 'Saldo insuficiente'}), 400
            
        bank.current_balance -= amount_to_pay
        if card.limit is not None: card.limit += amount_to_pay

        # Fecha as despesas antigas
        expenses_to_close = Expense.query.filter(Expense.card_id == card.id, Expense.status == 'OPEN', Expense.date <= payment_date).all()
        for exp in expenses_to_close: exp.status = 'CLOSED' 
            
        # CRIA O REGISTRO DO PAGAMENTO
        # Mudança aqui: card_id=card.id (Antes era None)
        # Isso permite que a tabela saiba que esse pagamento pertence ao cartão X e use o dia de vencimento dele para calcular o ciclo.
        invoice_expense = Expense(
            description=f"Fatura {card.name}", 
            amount=amount_to_pay, 
            date=payment_date, 
            category="Pagamento de Fatura", 
            account_name=f"{bank.name} (Pgto Fatura)", 
            payment_method="Débito", 
            bank_account_id=bank.id, 
            card_id=card.id, # <--- VÍNCULO RESTAURADO
            is_credit_card=False, 
            status='CLOSED'
        )
        db.session.add(invoice_expense)
        db.session.commit()
        return jsonify({'message': 'Pago com sucesso!'})
    except Exception as e:
        db.session.rollback(); return jsonify({'error': str(e)}), 500
# --- GESTÃO DE CONTAS ---
@app.route('/api/accounts/<int:id>/color', methods=['PATCH'])
def update_account_color(id):
    acc = BankAccount.query.get(id)
    if not acc: return jsonify({'error': 'Not found'}), 404
    acc.color = request.json['color']
    db.session.commit()
    return jsonify({'message': 'Cor atualizada'})

@app.route('/api/accounts', methods=['GET', 'POST'])
def manage_accounts():
    if request.method == 'POST':
        color = request.json.get('color', '#00e676')
        db.session.add(BankAccount(name=request.json['name'], color=color))
        db.session.commit()
        return jsonify({'msg': 'Ok'}), 201
    
    accounts = BankAccount.query.all()
    output = []
    today = date.today()
    
    for acc in accounts:
        cards_data = []
        for card in acc.cards:
            open_invoice = db.session.query(func.sum(Expense.amount)).filter(Expense.card_id == card.id, Expense.status == 'OPEN', Expense.date <= today).scalar() or 0.0
            cards_data.append({'id': card.id, 'name': card.name, 'type': card.card_type, 'limit': card.limit, 'closing_day': card.closing_day, 'due_day': card.due_day, 'open_invoice': open_invoice})
        
        output.append({
            'id': acc.id, 'name': acc.name, 'balance': acc.current_balance, 'color': acc.color, 'cards': cards_data
        })
    return jsonify(output)

@app.route('/api/accounts/<int:id>/balance', methods=['PATCH'])
def update_account_balance(id):
    acc = BankAccount.query.get(id)
    acc.current_balance = float(request.json['balance'])
    db.session.commit()
    return jsonify({'message': 'Saldo atualizado'})

@app.route('/api/cards/<int:id>/limit', methods=['PATCH'])
def update_card_limit(id):
    card = Card.query.get(id)
    card.limit = float(request.json['limit'])
    db.session.commit()
    return jsonify({'message': 'Limite atualizado'})

# --- DADOS DO GRÁFICO ANUAL (ATUALIZADO: Ignora Transferências) ---
@app.route('/api/dashboard/annual', methods=['GET'])
def annual_chart_data():
    current_year = date.today().year
    all_expenses = Expense.query.filter(extract('year', Expense.date) == current_year).all()
    credit_totals = {m: 0.0 for m in range(1, 13)}
    debit_totals = {m: 0.0 for m in range(1, 13)}
    
    for e in all_expenses:
        if e.category == "Pagamento de Fatura": continue 
        if e.category == "Transferência": continue # <--- AQUI: Não mostra transferência no gráfico
        
        month = e.date.month
        card_obj = Card.query.get(e.card_id) if e.card_id else None
        c_type = card_obj.card_type if card_obj else None
        
        is_credit = ('Crédito' in e.payment_method) or (c_type == 'CREDIT')
        
        if is_credit: credit_totals[month] += e.amount
        else: debit_totals[month] += e.amount
        
    return jsonify({'credit': list(credit_totals.values()), 'debit': list(debit_totals.values())})
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
        for n in ["Alimentação", "Transporte", "Lazer", "Casa", "Educação", "Saúde", "Outros", "Pagamento de Fatura"]: db.session.add(Category(name=n))
        db.session.commit()

if __name__ == '__main__':
    app.run(debug=True)



pay_invoice