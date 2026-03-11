import os
import uuid
import calendar
import holidays
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


# --- UTILITÁRIOS (ROBUSTEZ DE CARTÃO DE CRÉDITO) ---
def get_installment_due_date(base_date, card, installment_index=0):
    """
    Calcula a data exata de VENCIMENTO em que uma parcela vai cair.
    Lógica: Se a data da compra passou do fechamento, a 1ª parcela vai para o mês seguinte.
    """
    month = base_date.month
    year = base_date.year
    
    # Se a compra foi DEPOIS do dia de fechamento, cai na próxima fatura
    if card and card.closing_day and base_date.day > card.closing_day:
        month += 1
        
    # Adiciona os meses da parcela atual (0 para a primeira, 1 para a segunda...)
    month += installment_index
    
    # Ajusta a virada de ano
    year += (month - 1) // 12
    month = (month - 1) % 12 + 1
    
    # O dia será o dia do vencimento do cartão (se não tiver, usa o fechamento ou o dia da compra)
    target_day = card.due_day if (card and card.due_day) else (card.closing_day if (card and card.closing_day) else base_date.day)
    
    # Previne erros de calendário (ex: 31 de fevereiro)
    target_day = min(target_day, calendar.monthrange(year, month)[1])
    
    return date(year, month, target_day)

# Instancia os feriados do Brasil para consulta rápida
br_holidays = holidays.Brazil()

def get_next_business_day(target_date):
    """
    Verifica se a data cai em fim de semana ou feriado.
    Se sim, empurra para o próximo dia útil.
    """
    # weekday(): 0=Segunda ... 5=Sábado, 6=Domingo
    while target_date.weekday() >= 5 or target_date in br_holidays:
        target_date += timedelta(days=1)
    return target_date

def get_installment_due_date(base_date, card, installment_index=0):
    """
    Calcula a data exata de VENCIMENTO.
    Lida perfeitamente com cartões onde o Vencimento (dia 4) é menor que o Fechamento (dia 25).
    """
    month = base_date.month
    year = base_date.year
    
    # 1. Pega os dias do cartão (ou usa o dia da compra como segurança se estiver vazio)
    closing = card.closing_day if (card and card.closing_day) else base_date.day
    due = card.due_day if (card and card.due_day) else closing
    
    # 2. Descobre em qual mês essa fatura FECHA
    closing_month = month
    if base_date.day > closing:
        closing_month += 1
        
    # 3. Descobre em qual mês essa fatura VENCE
    due_month = closing_month
    if due < closing:
        # Se vence dia 4, mas fecha dia 25, o pagamento é sempre no mês seguinte ao fechamento!
        due_month += 1
        
    # 4. Adiciona o índice da parcela (0, 1, 2...)
    due_month += installment_index
    
    # 5. Ajusta a virada de ano matematicamente
    year += (due_month - 1) // 12
    due_month = (due_month - 1) % 12 + 1
    
    # 6. Previne erros de calendário (ex: vencimento dia 31 caindo em fevereiro)
    target_day = min(due, calendar.monthrange(year, due_month)[1])
    
    initial_due_date = date(year, due_month, target_day)
    
    # Aplica a regra do Banco Central (pula finais de semana e feriados)
    return get_next_business_day(initial_due_date)

def calculate_open_invoice_window(card, ref_date=None):
    """
    Soma APENAS as despesas que pertencem EXATAMENTE ao ciclo da fatura atual.
    Blinda contra compras antigas (retroativas) não pagas sendo somadas juntas.
    """
    if not ref_date: ref_date = date.today()
    
    # 1. Data de vencimento da fatura ATUAL (O teto)
    current_due_date = get_installment_due_date(ref_date, card, 0)
    
    # 2. Descobre o mês passado para calcular o vencimento ANTERIOR
    m = ref_date.month - 1
    y = ref_date.year
    if m < 1:
        m = 12
        y -= 1
        
    # Previne erros de calendário ao voltar um mês (ex: 31 de Março -> 28 de Fevereiro)
    prev_day = min(ref_date.day, calendar.monthrange(y, m)[1])
    prev_ref_date = date(y, m, prev_day)
    
    # 3. Data de vencimento da fatura PASSADA (O piso / escudo)
    prev_due_date = get_installment_due_date(prev_ref_date, card, 0)
    
    all_open = Expense.query.filter_by(card_id=card.id, status='OPEN').all()
    total = 0.0
    
    for expense in all_open:
        e_date = expense.date
        if isinstance(e_date, str):
            try: e_date = datetime.strptime(e_date, '%Y-%m-%d').date()
            except: continue

        # A BLINDAGEM: A conta precisa vencer DEPOIS da fatura passada e ATÉ a fatura atual
        if e_date > prev_due_date and e_date <= current_due_date:
            total += expense.amount
            
    return total, current_due_date
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
    is_income = db.Column(db.Boolean, default=False) # ADICIONADO: Flag para identificar Renda

# --- ROTAS ---
@app.route('/')
def index(): return render_template('index.html')

@app.route('/reset-force')
def reset_force():
    try:
        db.drop_all()
        db.create_all()
        if not Category.query.first():
            for n in ["Alimentação", "Transporte", "Lazer", "Casa", "Educação", "Saúde", "Outros", "Pagamento de Fatura", "Transferência", "Gastos Fixos", "Receitas"]: # ADICIONADO "Receitas"
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
    
    # Estrutura de totais
    c15 = {'cards': 0.0, 'fixed': 0.0, 'others': 0.0, 'total': 0.0}
    c30 = {'cards': 0.0, 'fixed': 0.0, 'others': 0.0, 'total': 0.0}
    
    # 1. Cartões de Crédito (Soma fatura aberta)
    # A lógica de cartão já está perfeita: soma o que foi gasto no cartão.
    cards = Card.query.filter_by(card_type='CREDIT').all()
    for card in cards:
        invoice_val, _ = calculate_open_invoice_window(card, today)
        if invoice_val > 0:
            day = card.due_day or 10
            if 15 <= day <= 29: c15['cards'] += invoice_val
            else: c30['cards'] += invoice_val

    # 2. Gastos Fixos (COM VERIFICAÇÃO DE LANÇAMENTO)
    # Aqui está o segredo: Só somamos o Fixo se ele NÃO foi lançado ainda.
    # Se já foi lançado, ele vai aparecer na soma de "Cartões" (se foi crédito) ou "Outros" (se foi débito).
    
    fixeds = FixedExpense.query.all()
    
    # Busca todas as despesas deste mês para comparar
    current_month_expenses = Expense.query.filter(
        extract('year', Expense.date) == today.year,
        extract('month', Expense.date) == today.month
    ).all()
    
    # Cria uma lista de nomes de despesas que já existem este mês
    # Ex: ["Aluguel (Fixo)", "Internet (Fixo)"]
    launched_names = [e.description for e in current_month_expenses]

    for f in fixeds:
        # Verifica se já existe uma despesa com o padrão de nome do lançamento
        # O padrão que definimos no 'launch_fixed' é: f"{f.name} (Fixo)"
        expected_name = f"{f.name} (Fixo)"
        
        is_launched = expected_name in launched_names
        
        # Se NÃO foi lançado, soma aqui como previsão.
        # Se JÁ foi lançado, ignoramos aqui (pois o valor real já está sendo somado em 'cards' ou 'others').
        if not is_launched:
            if 15 <= f.due_day <= 29: c15['fixed'] += f.amount
            else: c30['fixed'] += f.amount

    # 3. Outros (Gastos Variáveis + Fixos já lançados em Débito)
    # Filtra tudo que é OPEN, não é cartão e não é transferência.
    others = Expense.query.filter(
        Expense.status == 'OPEN', 
        Expense.card_id == None, 
        Expense.category != 'Transferência',
        Expense.is_income == False, # ADICIONADO: Ignora rendas na soma de contas a pagar
        Expense.date <= today
    ).all()

    for o in others:
        day = o.date.day
        if 15 <= day <= 29: c15['others'] += o.amount
        else: c30['others'] += o.amount

    # Totais Finais
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
        status_filter = request.args.get('status') # ADICIONADO: Filtro de Status
        
        if cat: query = query.filter_by(category=cat)
        if status_filter: query = query.filter_by(status=status_filter) # ADICIONADO: Aplica o filtro
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
            # ADICIONADO 'is_income' no retorno
            output.append({'id': e.id, 'description': e.description, 'amount': e.amount, 'date': str(e.date), 'category': e.category, 'account': e.account_name, 'payment_method': e.payment_method, 'current_installment': e.current_installment, 'total_installments': e.total_installments, 'card_id': e.card_id, 'bank_account_id': e.bank_account_id, 'computed_cycle': cycle, 'status': e.status, 'is_income': e.is_income})
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
            
            status = 'OPEN'
            card = None
            
            if c_id:
                card = Card.query.get(c_id)
                if card:
                    if card.limit is not None and card.limit < amt_tot:
                        return jsonify({'error': 'Limite insuficiente'}), 400
                    card.limit -= amt_tot
            elif b_id:
                status = 'CLOSED'
                b = BankAccount.query.get(b_id)
                if b:
                    if b.current_balance < amt_tot:
                        return jsonify({'error': 'Saldo insuficiente'}), 400
                    b.current_balance -= amt_tot

            for i in range(inst_tot):
                if card:
                    # Para Cartão: A data no banco vira a DATA DO VENCIMENTO da fatura
                    this_date = get_installment_due_date(base_date, card, i)
                    # Registramos o dia da compra real na descrição para você não esquecer
                    desc = f"{d['description']} ({base_date.strftime('%d/%m')})"
                else:
                    # Para Débito/Pix: Salva a data real e apenas soma os meses
                    this_date = add_months(base_date, i)
                    desc = d['description']

                db.session.add(Expense(
                    description=desc, 
                    amount=inst_val, 
                    date=this_date, 
                    category=d['category'], 
                    account_name=d['account_name'], 
                    payment_method=d['payment_method'], 
                    bank_account_id=b_id, 
                    card_id=c_id, 
                    is_credit_card=d.get('is_credit_card', False), 
                    total_installments=inst_tot, 
                    current_installment=i+1, 
                    description_original=d['description'], 
                    group_id=grp_id, 
                    status=status,
                    is_income=False
                ))
            db.session.commit()
            return jsonify({'message': 'Salvo!'}), 201
        except Exception as e: 
            db.session.rollback()
            return jsonify({'error': str(e)}), 500

@app.route('/api/expenses/<id>', methods=['DELETE', 'PUT'])
def expense_ops(id):
    e = Expense.query.get(id)
    if not e: return jsonify({'error': '404'}), 404
    if request.method == 'DELETE':
        try:
            scope = request.args.get('scope', 'single')
            to_del = Expense.query.filter_by(group_id=e.group_id).all() if scope == 'all' and e.group_id else [e]
            for item in to_del:
                # ADICIONADO: Lógica de exclusão reversa para Rendas
                if item.is_income:
                    if item.bank_account_id:
                        b = BankAccount.query.get(item.bank_account_id)
                        if b: b.current_balance -= item.amount
                else:
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

# --- NOVA ROTA: REGISTRO DE RENDA ---
@app.route('/api/incomes', methods=['POST'])
def add_income():
    try:
        d = request.json
        dt = datetime.strptime(d['date'], '%Y-%m-%d').date()
        amt = float(d['amount'])
        b_id = int(d['bank_account_id'])
        
        bank = BankAccount.query.get(b_id)
        if not bank: return jsonify({'error': 'Conta de destino não encontrada'}), 404
        
        # Aumenta o saldo do banco
        bank.current_balance += amt
        
        # Salva o registro marcando como Renda (is_income = True)
        db.session.add(Expense(
            description=d['description'],
            amount=amt,
            date=dt,
            category="Receitas",
            account_name=bank.name,
            payment_method="Pix", 
            bank_account_id=bank.id,
            status='CLOSED', # Rendas já entram como "recebidas" (pagas)
            is_income=True
        ))
        db.session.commit()
        return jsonify({'message': 'Renda registrada com sucesso!'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

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
        all_open = Expense.query.filter(Expense.card_id == card.id, Expense.status == 'OPEN').all()
        for ex in all_open:
            ex_date = ex.date
            if isinstance(ex_date, str): 
                try: ex_date = datetime.strptime(ex_date, '%Y-%m-%d').date()
                except: continue
            
            # Fecha todas as parcelas que vencem até a data da fatura que estamos pagando
            if ex_date <= closing_date:
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
        # ADICIONADO: Ignora renda e transferência no gráfico de gastos
        if e.category in ["Pagamento de Fatura", "Transferência"] or getattr(e, 'is_income', False): continue
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
        # ADICIONADO "Receitas" nas categorias base
        for n in ["Alimentação", "Transporte", "Lazer", "Casa", "Educação", "Saúde", "Outros", "Pagamento de Fatura", "Transferência", "Gastos Fixos", "Receitas"]: db.session.add(Category(name=n))
        db.session.commit()

if __name__ == '__main__': app.run(debug=True)