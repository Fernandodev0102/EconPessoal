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
    """Adiciona meses preservando o dia (ex: 20/02 + 1 mês = 20/03)."""
    month = source_date.month - 1 + months
    year = source_date.year + month // 12
    month = month % 12 + 1
    day = min(source_date.day, calendar.monthrange(year, month)[1])
    return source_date.replace(year=year, month=month, day=day)

def get_next_closing_date(card, ref_date=None):
    """Calcula a data do fechamento da fatura VIGENTE."""
    if not ref_date: ref_date = date.today()
    if not card.closing_day: return ref_date 

    # Se hoje <= dia fechamento, fatura fecha neste mês
    if ref_date.day <= card.closing_day:
        return date(ref_date.year, ref_date.month, card.closing_day)
    else:
        # Se passou, fatura fecha mês que vem
        month = ref_date.month + 1
        year = ref_date.year
        if month > 12:
            month = 1
            year += 1
        day = min(card.closing_day, calendar.monthrange(year, month)[1])
        return date(year, month, day)

def get_invoice_period(card, ref_date=None):
    """Define o INÍCIO e FIM da fatura vigente para filtragem exata."""
    if not ref_date: ref_date = date.today()
    
    # Cartão sem data definida: mostra tudo até hoje
    if not card.closing_day: 
        return date(1900, 1, 1), ref_date 

    # Descobre o FIM (Closing Date)
    if ref_date.day <= card.closing_day:
        closing_date = date(ref_date.year, ref_date.month, card.closing_day)
        # Início = Fechamento do mês passado
        prev_month = ref_date.month - 1 if ref_date.month > 1 else 12
        prev_year = ref_date.year if ref_date.month > 1 else ref_date.year - 1
        prev_day = min(card.closing_day, calendar.monthrange(prev_year, prev_month)[1])
        start_date = date(prev_year, prev_month, prev_day)
    else:
        # Fatura do próximo mês
        closing_month = ref_date.month + 1 if ref_date.month < 12 else 1
        closing_year = ref_date.year if ref_date.month < 12 else ref_date.year + 1
        day_adj = min(card.closing_day, calendar.monthrange(closing_year, closing_month)[1])
        closing_date = date(closing_year, closing_month, day_adj)
        
        # Início = Fechamento deste mês
        start_day = min(card.closing_day, calendar.monthrange(ref_date.year, ref_date.month)[1])
        start_date = date(ref_date.year, ref_date.month, start_day)

    return start_date, closing_date

def calculate_open_invoice_window(card, ref_date=None):
    """
    Soma despesas que caem DENTRO da janela da fatura atual.
    Ignora compras antigas (já fechadas) e futuras (próxima fatura).
    """
    if not ref_date: ref_date = date.today()
    start_date, end_date = get_invoice_period(card, ref_date)
    
    all_open = Expense.query.filter_by(card_id=card.id, status='OPEN').all()
    total = 0.0
    
    for expense in all_open:
        e_date = expense.date
        if isinstance(e_date, str):
            try: e_date = datetime.strptime(e_date, '%Y-%m-%d').date()
            except: continue

        # A despesa pertence a esta fatura SE: Data > Inicio E Data <= Fim
        if e_date > start_date and e_date <= end_date:
            total += expense.amount
            
    return total, end_date

# --- MODELOS ---
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
    payment_method = db.Column(db.String(50), nullable=True) 
    card_id = db.Column(db.Integer, db.ForeignKey('card.id'), nullable=True)
    bank_account_id = db.Column(db.Integer, db.ForeignKey('bank_account.id'), nullable=True)

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
    transfer_dest_id = db.Column(db.Integer, nullable=True)

# --- ROTAS ---
@app.route('/')
def index(): return render_template('index.html')

@app.route('/reset-force')
def reset_force():
    try:
        db.drop_all()
        db.create_all()
        if not Category.query.first():
            for n in ["Alimentação", "Transporte", "Lazer", "Casa", "Educação", "Saúde", "Outros", "Pagamento de Fatura", "Transferência", "Gastos Fixos"]: 
                db.session.add(Category(name=n))
            db.session.commit()
        return "<h1>Sistema Resetado!</h1>"
    except Exception as e: return f"Erro: {str(e)}"

@app.route('/api/fixed_expenses', methods=['GET', 'POST'])
def handle_fixed():
    if request.method == 'POST':
        d = request.json
        c_id = int(d['card_id']) if d.get('card_id') else None
        b_id = int(d['bank_account_id']) if d.get('bank_account_id') else None
        db.session.add(FixedExpense(name=d['name'], amount=float(d['amount']), due_day=int(d['due_day']), payment_method=d['payment_method'], card_id=c_id, bank_account_id=b_id))
        db.session.commit()
        return jsonify({'msg':'ok'})
    
    fixeds = FixedExpense.query.all()
    output = []
    for f in fixeds:
        src = "Indefinido"
        if f.card_id:
            c = Card.query.get(f.card_id)
            src = f"Cartão: {c.name}" if c else "Cartão Excluído"
        elif f.bank_account_id:
            b = BankAccount.query.get(f.bank_account_id)
            src = f"Conta: {b.name}" if b else "Conta Excluída"
        output.append({'id': f.id, 'name': f.name, 'amount': f.amount, 'due_day': f.due_day, 'source_desc': src, 'payment_method': f.payment_method, 'card_id': f.card_id, 'bank_account_id': f.bank_account_id})
    return jsonify(output)

@app.route('/api/fixed_expenses/<int:id>', methods=['DELETE', 'PUT'])
def fixed_ops(id):
    f = FixedExpense.query.get(id)
    if not f: return jsonify({'error': '404'}), 404
    if request.method == 'DELETE': db.session.delete(f); db.session.commit(); return jsonify({'msg':'ok'})
    if request.method == 'PUT':
        d = request.json
        f.name = d['name']; f.amount = float(d['amount']); f.due_day = int(d['due_day'])
        db.session.commit(); return jsonify({'msg':'Atualizado'})

@app.route('/api/fixed_expenses/<int:id>/launch', methods=['POST'])
def launch_fixed(id):
    try:
        f = FixedExpense.query.get(id)
        if not f: return jsonify({'error': '404'}), 404
        real_amt = float(request.json.get('amount', f.amount))
        # REMOVIDA LÓGICA DE OFFSET DAQUI TAMBÉM (SE HOUVESSE)
        dt = datetime.strptime(request.json.get('date', date.today().strftime('%Y-%m-%d')), '%Y-%m-%d').date()
        st = 'OPEN'
        acc_n = f.payment_method
        if f.card_id:
            c = Card.query.get(f.card_id)
            st = 'OPEN'
            if c:
                acc_n = c.name
                if c.limit is not None and c.limit < real_amt: return jsonify({'error': 'Limite insuficiente'}), 400
                c.limit -= real_amt
        elif f.bank_account_id:
            b = BankAccount.query.get(f.bank_account_id)
            st = 'CLOSED'
            if b:
                acc_n = b.name
                if b.current_balance < real_amt: return jsonify({'error': 'Saldo insuficiente'}), 400
                b.current_balance -= real_amt
        db.session.add(Expense(description=f"{f.name} (Fixo)", amount=real_amt, date=dt, category="Gastos Fixos", account_name=acc_n, payment_method=f.payment_method, bank_account_id=f.bank_account_id, card_id=f.card_id, is_credit_card=(f.card_id is not None), status=st))
        db.session.commit()
        return jsonify({'msg': 'Lançado'})
    except Exception as e: db.session.rollback(); return jsonify({'error': str(e)}), 500

# --- DASHBOARD (COM JANELA DE TEMPO) ---
@app.route('/api/dashboard/cycles_projection', methods=['GET'])
def cycles_projection():
    today = date.today()
    c15 = {'cards': 0.0, 'fixed': 0.0, 'others': 0.0, 'total': 0.0}
    c30 = {'cards': 0.0, 'fixed': 0.0, 'others': 0.0, 'total': 0.0}
    
    cards = Card.query.filter_by(card_type='CREDIT').all()
    for card in cards:
        invoice_val, _ = calculate_open_invoice_window(card, today)
        if invoice_val > 0:
            day = card.due_day or 10
            if 15 <= day <= 29: c15['cards'] += invoice_val
            else: c30['cards'] += invoice_val

    fixeds = FixedExpense.query.all()
    for f in fixeds:
        if 15 <= f.due_day <= 29: c15['fixed'] += f.amount
        else: c30['fixed'] += f.amount

    others = Expense.query.filter(Expense.status == 'OPEN', Expense.card_id == None, Expense.category != 'Transferência', Expense.date <= today).all()
    for o in others:
        day = o.date.day
        if 15 <= day <= 29: c15['others'] += o.amount
        else: c30['others'] += o.amount

    c15['total'] = c15['cards'] + c15['fixed'] + c15['others']
    c30['total'] = c30['cards'] + c30['fixed'] + c30['others']
    return jsonify({'cycle_15': c15, 'cycle_30': c30})

# --- EXPENSES CRUD ---
@app.route('/api/expenses', methods=['GET', 'POST'])
def handle_expenses():
    if request.method == 'GET':
        query = Expense.query
        cat = request.args.get('category')
        pay = request.args.get('payment_method')
        month_str = request.args.get('month') 
        src = request.args.get('source') 
        if cat: query = query.filter_by(category=cat)
        if pay:
            if pay == "Crédito": query = query.filter(Expense.payment_method.like('%Crédito%'))
            elif pay == "Vista": query = query.filter(Expense.payment_method.in_(['Pix', 'Débito', 'Dinheiro']))
            else: query = query.filter_by(payment_method=pay)
        if month_str:
            try:
                y, m = map(int, month_str.split('-'))
                query = query.filter(extract('year', Expense.date) == y, extract('month', Expense.date) == m)
            except: pass
        if src:
            if src.startswith('ACC-'): query = query.filter(Expense.bank_account_id == int(src.split('-')[1]))
            elif src.startswith('CARD-'): query = query.filter(Expense.card_id == int(src.split('-')[1]))

        expenses_raw = query.order_by(Expense.date.desc()).all()
        output = []
        for e in expenses_raw:
            cycle = 30
            day_ref = e.date.day
            if e.card_id:
                c = Card.query.get(e.card_id)
                if c and c.due_day: day_ref = c.due_day
            if 15 <= day_ref <= 29: cycle = 15
            output.append({'id': e.id, 'description': e.description, 'amount': e.amount, 'date': str(e.date), 'category': e.category, 'account': e.account_name, 'payment_method': e.payment_method, 'current_installment': e.current_installment, 'total_installments': e.total_installments, 'card_id': e.card_id, 'bank_account_id': e.bank_account_id, 'computed_cycle': cycle, 'status': e.status})
        return jsonify(output)

    if request.method == 'POST':
        try:
            d = request.json
            base_date = datetime.strptime(d['date'], '%Y-%m-%d').date()
            c_id = int(d['card_id']) if d.get('card_id') else None
            b_id = int(d['bank_account_id']) if d.get('bank_account_id') else None
            inst_tot = int(d.get('total_installments', 1))
            amt_tot = float(d['amount'])
            grp_id = str(uuid.uuid4())
            inst_val = amt_tot / inst_tot
            
            # --- CORREÇÃO AQUI: REMOVIDO 'OFFSET' ---
            # Antes: Se data > fechamento, somava 1 mês na data.
            # Agora: Salva a data real. A função 'calculate_open_invoice_window' saberá que isso é fatura futura.
            offset = 0 
            status = 'OPEN'
            
            if c_id:
                card = Card.query.get(c_id)
                if card:
                    if card.limit is not None and card.limit < amt_tot: return jsonify({'error': 'Limite insuficiente'}), 400
                    card.limit -= amt_tot
            elif b_id:
                status = 'CLOSED'
                b = BankAccount.query.get(b_id)
                if b:
                    if b.current_balance < amt_tot: return jsonify({'error': 'Saldo insuficiente'}), 400
                    b.current_balance -= amt_tot

            for i in range(inst_tot):
                this_date = add_months(base_date, i + offset)
                db.session.add(Expense(description=d['description'], amount=inst_val, date=this_date, category=d['category'], account_name=d['account_name'], payment_method=d['payment_method'], bank_account_id=b_id, card_id=c_id, is_credit_card=d.get('is_credit_card', False), total_installments=inst_tot, current_installment=i+1, description_original=d['description'], group_id=grp_id, status=status))
            db.session.commit()
            return jsonify({'message': 'Salvo!'}), 201
        except Exception as e: db.session.rollback(); return jsonify({'error': str(e)}), 500

@app.route('/api/expenses/<id>', methods=['DELETE', 'PUT'])
def expense_ops(id):
    e = Expense.query.get(id)
    if not e: return jsonify({'error': '404'}), 404
    if request.method == 'DELETE':
        try:
            scope = request.args.get('scope', 'single')
            to_del = Expense.query.filter_by(group_id=e.group_id).all() if scope == 'all' and e.group_id else [e]
            for item in to_del:
                if item.card_id:
                    c = Card.query.get(item.card_id)
                    if c and c.limit is not None: c.limit += item.amount
                elif item.bank_account_id:
                    b = BankAccount.query.get(item.bank_account_id)
                    if b: b.current_balance += item.amount
                if item.transfer_dest_id:
                    da = BankAccount.query.get(item.transfer_dest_id)
                    if da: da.current_balance -= item.amount
                db.session.delete(item)
            db.session.commit(); return jsonify({'message': 'Excluído'})
        except Exception as err: db.session.rollback(); return jsonify({'error': str(err)}), 500
    if request.method == 'PUT': return jsonify({'error': 'Edição desativada'}), 400

@app.route('/api/transfers', methods=['POST'])
def transfer_balance():
    try:
        d = request.json
        s_id, d_id, amt = int(d['source_id']), int(d['dest_id']), float(d['amount'])
        if s_id == d_id or amt <= 0: return jsonify({'error': 'Dados inválidos'}), 400
        src, dst = BankAccount.query.get(s_id), BankAccount.query.get(d_id)
        if not src or not dst or src.current_balance < amt: return jsonify({'error': 'Saldo/Conta inválida'}), 400
        src.current_balance -= amt; dst.current_balance += amt
        db.session.add(Expense(description=f"Transf. para {dst.name}", amount=amt, date=datetime.strptime(d['date'], '%Y-%m-%d').date(), category="Transferência", account_name=src.name, payment_method="Pix", bank_account_id=src.id, status='CLOSED', transfer_dest_id=d_id))
        db.session.commit()
        return jsonify({'message': 'Sucesso!'})
    except Exception as e: db.session.rollback(); return jsonify({'error': str(e)}), 500

@app.route('/api/cards/pay_invoice', methods=['POST'])
def pay_invoice():
    try:
        d = request.json
        c_id, b_id, amt = int(d['card_id']), int(d['bank_account_id']), float(d['amount'])
        dt = datetime.strptime(d['date'], '%Y-%m-%d').date()
        card, bank = Card.query.get(c_id), BankAccount.query.get(b_id)
        
        # 1. Calcula Dívida Real (Janela Atual)
        real_debt, closing_date = calculate_open_invoice_window(card, dt)
        real_debt = round(real_debt, 2)
        amt = round(amt, 2)

        if amt > (real_debt + 0.05): return jsonify({'error': f'Máximo: R$ {real_debt}'}), 400
        if bank.current_balance < amt: return jsonify({'error': 'Saldo insuficiente'}), 400
            
        bank.current_balance -= amt
        if card.limit is not None: card.limit += amt

        # 2. Fecha itens da Janela Atual
        start_date, end_date = get_invoice_period(card, dt)
        all_open = Expense.query.filter(Expense.card_id == card.id, Expense.status == 'OPEN').all()
        for ex in all_open:
            ex_date = ex.date
            if isinstance(ex_date, str): 
                try: ex_date = datetime.strptime(ex_date, '%Y-%m-%d').date()
                except: continue
            
            # Fecha se estiver dentro da janela que estamos pagando
            if ex_date <= end_date:
                ex.status = 'CLOSED'
        
        # 3. Rollover (Dívida Restante)
        rem = real_debt - amt
        if rem > 0.01:
            db.session.add(Expense(description=f"Restante Fatura ({dt.strftime('%d/%m')})", amount=rem, date=dt, category="Pagamento de Fatura", account_name=card.name, payment_method="Crédito", card_id=card.id, is_credit_card=True, status='OPEN'))

        db.session.add(Expense(description=f"Fatura {card.name} (Pago)", amount=amt, date=dt, category="Pagamento de Fatura", account_name=f"{bank.name}", payment_method="Débito", bank_account_id=bank.id, card_id=card.id, status='CLOSED'))
        db.session.commit()
        return jsonify({'message': 'Pago!'})
    except Exception as e: db.session.rollback(); return jsonify({'error': str(e)}), 500

@app.route('/api/accounts/<int:id>/color', methods=['PATCH'])
def upd_color(id):
    acc = BankAccount.query.get(id); acc.color = request.json['color']; db.session.commit(); return jsonify({'msg':'ok'})

@app.route('/api/accounts', methods=['GET', 'POST'])
def manage_accounts():
    if request.method == 'POST':
        db.session.add(BankAccount(name=request.json['name'], color=request.json.get('color', '#00e676'))); db.session.commit(); return jsonify({'msg':'ok'}), 201
    
    accs = BankAccount.query.all()
    out = []
    today = date.today()
    for a in accs:
        c_dat = []
        for c in a.cards:
            op_inv, _ = calculate_open_invoice_window(c, today)
            c_dat.append({'id': c.id, 'name': c.name, 'type': c.card_type, 'limit': c.limit, 'closing_day': c.closing_day, 'due_day': c.due_day, 'open_invoice': op_inv})
        out.append({'id': a.id, 'name': a.name, 'balance': a.current_balance, 'color': a.color, 'cards': c_dat})
    return jsonify(out)

@app.route('/api/accounts/<int:id>/balance', methods=['PATCH'])
def upd_bal(id): BankAccount.query.get(id).current_balance = float(request.json['balance']); db.session.commit(); return jsonify({'msg':'ok'})
@app.route('/api/cards/<int:id>/limit', methods=['PATCH'])
def upd_lim(id): Card.query.get(id).limit = float(request.json['limit']); db.session.commit(); return jsonify({'msg':'ok'})
@app.route('/api/dashboard/annual', methods=['GET'])
def annual_chart():
    yr = date.today().year
    exps = Expense.query.filter(extract('year', Expense.date) == yr).all()
    cr, db_vals = [0.0]*13, [0.0]*13
    for e in exps:
        if e.category in ["Pagamento de Fatura", "Transferência"]: continue
        m = e.date.month
        c_obj = Card.query.get(e.card_id) if e.card_id else None
        is_cr = ('Crédito' in e.payment_method) or (c_obj and c_obj.card_type == 'CREDIT')
        if is_cr: cr[m] += e.amount
        else: db_vals[m] += e.amount
    return jsonify({'credit': cr[1:], 'debit': db_vals[1:]})
@app.route('/api/accounts/<int:id>', methods=['DELETE'])
def del_acc(id): db.session.delete(BankAccount.query.get(id)); db.session.commit(); return jsonify({'msg':'ok'})
@app.route('/api/cards', methods=['POST'])
def add_card():
    d = request.json; db.session.add(Card(name=d['name'], card_type=d['card_type'], limit=float(d.get('limit') or 0), closing_day=int(d.get('closing_day') or 0) or None, due_day=int(d.get('due_day') or 0) or None, bank_account_id=int(d['bank_account_id'])))
    db.session.commit(); return jsonify({'msg':'ok'}), 201
@app.route('/api/cards/<int:id>', methods=['DELETE'])
def del_card(id): db.session.delete(Card.query.get(id)); db.session.commit(); return jsonify({'msg':'ok'})
@app.route('/api/categories', methods=['GET', 'POST'])
def cats():
    if request.method=='POST': db.session.add(Category(name=request.json['name'])); db.session.commit(); return jsonify({'msg':'ok'}), 201
    return jsonify([{'id':c.id, 'name':c.name} for c in Category.query.all()])
@app.route('/api/categories/<int:id>', methods=['DELETE', 'PUT'])
def cat_ops(id):
    c = Category.query.get(id)
    if request.method=='DELETE': db.session.delete(c)
    else: c.name = request.json['name']
    db.session.commit(); return jsonify({'msg':'ok'})

with app.app_context():
    db.create_all()
    if not Category.query.first():
        for n in ["Alimentação", "Transporte", "Lazer", "Casa", "Educação", "Saúde", "Outros", "Pagamento de Fatura", "Transferência", "Gastos Fixos"]: db.session.add(Category(name=n))
        db.session.commit()

if __name__ == '__main__': app.run(debug=True)