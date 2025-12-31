import { db } from './firebase-config.js';
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* =========================================
   Global Variables
   ========================================= */
let currentProduct = null;
let currentMainCat = 'all';
let currentEditingOrderId = null;
let globalOrders = [];

/* =========================================
   Initialization
   ========================================= */
document.addEventListener('DOMContentLoaded', async () => {
    // Client Page
    if (document.getElementById('productsContainer')) {
        initMobileMenu();
        await loadMainCategoriesUser();
        await loadProductsUser('all', 'all');
        updateCartCount();
        loadUserProfile();
    }
    
    // Admin Page
    if (document.getElementById('dashboardSection')) {
        initAdmin();
        document.body.addEventListener('click', () => {
            const sound = document.getElementById('notificationSound');
            if(sound) sound.play().then(() => { sound.pause(); sound.currentTime = 0; document.getElementById('soundStatus').innerText = "حالة الصوت: مفعل ✅"; }).catch(() => {});
        }, {once: true});
    }
});

/* =========================================
   Admin Logic
   ========================================= */
async function initAdmin() {
    await loadCategoriesManager();
    await populateCategorySelects();
    
    // Realtime Listener for Orders
    const q = query(collection(db, "orders"), orderBy("date", "desc"));
    onSnapshot(q, (snapshot) => {
        let orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        globalOrders = orders;
        
        // Render
        renderOrdersAdmin(orders);
        updateDashboardStats(orders);
        window.filterArchive();
        
        // Sound Alert for new order (Simplified logic)
        const hasAdded = snapshot.docChanges().some(change => change.type === 'added');
        if(hasAdded && document.visibilityState === 'hidden') playAlertSound(); // only if background or logic refined
    });
}

function renderOrdersAdmin(orders) {
    const ordersBody = document.getElementById('ordersBody');
    if (!ordersBody) return;
    ordersBody.innerHTML = '';
    
    const activeOrders = orders.filter(o => o.status !== 'تم التوصيل');
    if (activeOrders.length === 0) { ordersBody.innerHTML = '<tr><td colspan="5" style="text-align:center">لا توجد طلبات جارية</td></tr>'; return; }
    
    activeOrders.forEach(order => {
        let statusClass = getStatusClass(order.status);
        let productsNames = order.items ? order.items.map(i=>i.productName).join(' + ') : order.productName;
        ordersBody.innerHTML += `<tr class="order-row" onclick="window.openOrderDetails('${order.id}')"><td>${order.customerName || 'ضيف'}</td><td>${order.customerPhone || '-'}</td><td>${productsNames}</td><td><span class="status-badge ${statusClass}">${order.status || 'قيد المراجعة'}</span></td><td>${new Date(order.date).toLocaleDateString('ar-EG')}</td></tr>`;
    });
}

function updateDashboardStats(orders) {
    document.getElementById('totalOrdersCount').innerText = orders.length;
    // Most Popular Logic
    if (orders.length > 0) {
        let counts = {};
        orders.forEach(o => { 
            let items = o.items || [{name: o.productName}];
            items.forEach(i => counts[i.name] = (counts[i.name] || 0) + 1);
        });
        let mostPopular = Object.keys(counts).length ? Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b) : '-';
        document.getElementById('mostPopularItem').innerText = mostPopular;
    }
}

// Archive Filter
window.filterArchive = function() {
    const tableBody = document.getElementById('archiveBody');
    const searchTerm = document.getElementById('archiveSearch').value.toLowerCase();
    const statusFilter = document.getElementById('archiveStatusFilter').value;
    const totalMoneyEl = document.getElementById('filteredTotalMoney');
    
    if (!tableBody) return;
    tableBody.innerHTML = '';

    let filtered = globalOrders.filter(order => {
        const matchesSearch = (order.customerName || '').toLowerCase().includes(searchTerm) || (order.customerPhone || '').includes(searchTerm);
        const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    if (filtered.length === 0) { tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center">لا توجد نتائج</td></tr>'; totalMoneyEl.innerText = '0 ج.م'; return; }

    let totalMoney = 0;
    filtered.forEach(order => {
        let statusClass = getStatusClass(order.status);
        let productsNames = order.items ? order.items.map(i=>i.productName).join(' + ') : order.productName;
        let priceStr = order.totalPrice || order.price;
        let priceVal = parseFloat(priceStr.toString().replace(/[^0-9.]/g, ''));
        if(!isNaN(priceVal)) totalMoney += priceVal;
        tableBody.innerHTML += `<tr class="order-row" onclick="window.openOrderDetails('${order.id}')"><td>${order.customerName || 'ضيف'}</td><td>${productsNames}</td><td>${priceStr}</td><td><span class="status-badge ${statusClass}">${order.status || 'قيد المراجعة'}</span></td><td>${new Date(order.date).toLocaleDateString('ar-EG')}</td></tr>`;
    });
    totalMoneyEl.innerText = Math.floor(totalMoney) + ' ج.م';
}

// Order Details Modal
window.openOrderDetails = function(id) {
    let order = globalOrders.find(o => o.id === id);
    if(!order) return; 
    currentEditingOrderId = id;
    const modal = document.getElementById('orderDetailsModal');
    const content = document.getElementById('orderDetailsContent');
    
    let productsHtml = '';
    if (order.items) { order.items.forEach(item => { productsHtml += `<li>${item.productName} - ${item.price} <small>(${item.type})</small></li>`; }); } else { productsHtml = `<li>${order.productName} - ${order.price} <small>(${order.type})</small></li>`; }
    
    content.innerHTML = `<p><strong>العميل:</strong> ${order.customerName}</p><p><strong>رقم الهاتف:</strong> ${order.customerPhone}</p><p><strong>العنوان:</strong> ${order.customerAddress}</p><p><strong>تاريخ الطلب:</strong> ${new Date(order.date).toLocaleString('ar-EG')}</p><hr><p><strong>المنتجات:</strong></p><ul>${productsHtml}</ul><p><strong>الإجمالي:</strong> ${order.totalPrice || order.price}</p>`;
    document.getElementById('updateStatusSelect').value = order.status || 'قيد المراجعة';
    document.getElementById('updateDaysInput').value = order.deliveryDays || '';
    modal.style.display = 'block';
}

window.saveOrderUpdates = async function() {
    if (!currentEditingOrderId) return;
    const status = document.getElementById('updateStatusSelect').value;
    const days = document.getElementById('updateDaysInput').value;
    await updateDoc(doc(db, "orders", currentEditingOrderId), { status: status, deliveryDays: days });
    alert('تم التحديث');
    window.closeOrderModal();
}

window.closeOrderModal = function() { document.getElementById('orderDetailsModal').style.display = 'none'; }

// Admin Categories
async function loadCategoriesManager() {
    const container = document.getElementById('categoriesManagerContainer');
    if(!container) return;
    container.innerHTML = 'جاري التحميل...';
    
    const snapshot = await getDocs(collection(db, "categories"));
    let cats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    container.innerHTML = '';
    cats.forEach((cat) => {
        let subsHtml = '';
        if(cat.subs) cat.subs.forEach((sub) => subsHtml += `<span class="sub-cat-badge">${sub} <i class="fa-solid fa-xmark delete-btn" onclick="window.deleteSubCategory('${cat.id}', '${sub}')"></i></span>`);
        
        container.innerHTML += `<div class="cat-manager-item"><div class="main-cat-header"><span class="main-cat-title">${cat.name}</span> <button class="delete-btn" style="background:none; border:none;" onclick="window.deleteMainCategory('${cat.id}')">حذف</button></div><div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center;"><div>${subsHtml}</div><div style="display:flex; gap:5px;"><input type="text" id="newSub_${cat.id}" placeholder="فرع جديد" style="padding:5px;"><button onclick="window.addSubCategory('${cat.id}')" style="padding:5px;">+</button></div></div></div>`;
    });
}
window.addNewMainCategory = async function() {
    const v=document.getElementById('newMainCatName').value.trim();
    if(v){ await addDoc(collection(db, "categories"), {name:v, subs:[]}); loadCategoriesManager(); populateCategorySelects(); document.getElementById('newMainCatName').value=''; }
}
window.deleteMainCategory = async function(id) {
    if(confirm('حذف؟')) { await deleteDoc(doc(db, "categories", id)); loadCategoriesManager(); populateCategorySelects(); }
}
window.addSubCategory = async function(id) {
    const v=document.getElementById('newSub_'+id).value.trim();
    if(v){ alert('للأسف إضافة الفرع تتطلب تحديث المصفوفة، يرجى استخدام Firebase Console أو تحديث الصفحة بعد الإضافة يدوياً في هذه النسخة البسيطة'); }
}

// Add Product
const productForm = document.getElementById('productForm');
if(productForm){ 
    productForm.addEventListener('submit', async e => { 
        e.preventDefault(); 
        const catSelect = document.getElementById('pCategory');
        const catName = catSelect.options[catSelect.selectedIndex].text;
        
        const p = { 
            name: document.getElementById('pName').value, 
            img: document.getElementById('pImg').value, 
            desc: document.getElementById('pDesc').value, 
            price: parseFloat(document.getElementById('pPrice').value), 
            discount: parseFloat(document.getElementById('pDiscount').value)||0, 
            category: catName, 
            subCategory: document.getElementById('pSubCategory').value,
            createdAt: Date.now()
        };
        await addDoc(collection(db, "products"), p);
        alert('تم النشر'); productForm.reset(); 
    });
}

/* =========================================
   Client Logic
   ========================================= */
function initMobileMenu() { const m=document.getElementById('mobile-menu'); const n=document.getElementById('nav-list'); if(m&&n){ m.addEventListener('click',()=>{ n.classList.toggle('active'); m.querySelector('i').classList.toggle('fa-xmark'); m.querySelector('i').classList.toggle('fa-bars'); });}}

async function loadMainCategoriesUser() {
    const c=document.getElementById('mainCategoriesTabs'); if(!c)return;
    const snapshot = await getDocs(collection(db, "categories"));
    let cats = snapshot.docs.map(d => d.data());
    window.cachedCats = cats;
    c.innerHTML='<span class="active-cat" onclick="window.selectMainCategory(\'all\',this)">الكل</span>';
    cats.forEach(x=>c.innerHTML+=`<span onclick="window.selectMainCategory('${x.name}',this)">${x.name}</span>`);
}

async function loadProductsUser(m,s) {
    const c=document.getElementById('productsContainer');
    c.innerHTML = 'جاري التحميل...';
    const snapshot = await getDocs(collection(db, "products"));
    let products = snapshot.docs.map(d => ({id: d.id, ...d.data()}));
    
    let f=products; 
    if(m!=='all'){ f=f.filter(x=>x.category===m); if(s!=='all') f=f.filter(x=>x.subCategory===s); }
    
    c.innerHTML=''; 
    if(f.length===0){c.innerHTML='<p style="text-align:center;width:100%">لا يوجد منتجات</p>';return;}
    
    f.forEach(x=>{ 
        let fp=x.discount>0?x.price-(x.price*(x.discount/100)):x.price; 
        const prodString = encodeURIComponent(JSON.stringify(x));
        c.innerHTML+=`<div class="product-card" onclick="window.openProductModalDecode('${prodString}')"><div class="img-container">${x.discount>0?`<span class="discount-badge">-${x.discount}%</span>`:''}<img src="${x.img}" onerror="this.src='https://via.placeholder.com/300'"></div><div class="p-info"><h3>${x.name}</h3><div class="price-row"><span class="current-price">${Math.floor(fp)} ج.م</span>${x.discount>0?`<span class="old-price">${x.price}</span>`:''}</div></div></div>`; 
    });
}

// User Actions
window.openProductModalDecode = function(str) {
    const p = JSON.parse(decodeURIComponent(str));
    currentProduct = p;
    document.getElementById('mImg').src=p.img; document.getElementById('mTitle').innerText=p.name; document.getElementById('mCatTag').innerText=p.category; document.getElementById('mSubCatTag').innerText=p.subCategory||''; document.getElementById('mDesc').innerText=p.desc; let fp=p.discount>0?p.price-(p.price*(p.discount/100)):p.price; document.getElementById('mPrice').innerText=Math.floor(fp)+" ج.م"; let old=document.getElementById('mOldPrice'); if(p.discount>0){old.innerText=p.price;old.style.display='inline';}else{old.style.display='none';} document.getElementById('productModal').style.display='block';
}

window.finalizeOrder = async function(e) {
    e.preventDefault();
    const name = document.getElementById('cName').value;
    const phone = document.getElementById('cPhone').value;
    const addr = document.getElementById('cAddress').value;
    
    localStorage.setItem('shamma_user_profile', JSON.stringify({name, phone, address: addr}));
    
    let itemsToOrder = [];
    let totalPrice = 0;
    
    if (currentProduct && currentProduct.tempType) {
         let priceTxt = document.getElementById('mPrice').innerText;
         itemsToOrder.push({ productId: currentProduct.id, productName: currentProduct.name, price: priceTxt, type: 'حجز' });
         currentProduct.tempType = null;
         totalPrice = priceTxt;
    } else {
        itemsToOrder = JSON.parse(localStorage.getItem('shamma_cart')) || [];
        totalPrice = document.getElementById('totalPrice').innerText;
        if(itemsToOrder.length === 0) return;
    }

    const fullOrder = { customerName: name, customerPhone: phone, customerAddress: addr, items: itemsToOrder, totalPrice: totalPrice, date: Date.now(), status: 'قيد المراجعة', deliveryDays: '-' };

    await addDoc(collection(db, "orders"), fullOrder);
    localStorage.removeItem('shamma_cart');
    window.closeCheckoutModal();
    alert('تم استقبال طلبك بنجاح!');
    window.updateCartCount();
    document.getElementById('cartItems').innerHTML = '';
    window.toggleCart();
}

window.loadUserLogs = async function() {
    const profile = JSON.parse(localStorage.getItem('shamma_user_profile'));
    const ul = document.getElementById('myOrdersLog'); 
    if (!ul) return;
    ul.innerHTML = 'جاري التحميل...';
    
    if (!profile || !profile.phone) { ul.innerHTML = '<tr><td colspan="3">سجل دخول أولاً (أتمم طلب)</td></tr>'; return; }
    
    const q = query(collection(db, "orders"), where("customerPhone", "==", profile.phone), orderBy("date", "desc"));
    const snapshot = await getDocs(q);
    
    ul.innerHTML = '';
    if (snapshot.empty) { ul.innerHTML = '<tr><td colspan="3">لا يوجد سجل</td></tr>'; return; }
    
    snapshot.forEach(doc => {
        const l = doc.data();
        const prodName = l.items && l.items.length > 1 ? `طلب مجمع (${l.items.length})` : (l.items ? l.items[0].productName : l.productName);
        let statusColor = l.status==='تم التوصيل'?'#27ae60':(l.status==='خرج للشحن'?'#9b59b6':'#f39c12');
        ul.innerHTML+=`<tr><td><strong>${prodName}</strong></td><td><small>${new Date(l.date).toLocaleDateString('ar-EG')}</small></td><td><span class="log-status" style="background:${statusColor}">${l.status}</span></td></tr>`;
    });
}

/* =========================================
   Exposed Functions
   ========================================= */
window.showAdminSection = showAdminSection;
window.selectMainCategory = function(n,el){ currentMainCat=n; document.querySelectorAll('#mainCategoriesTabs span').forEach(s=>s.classList.remove('active-cat')); el.classList.add('active-cat'); const sc=document.getElementById('subCategoriesTabs'); sc.innerHTML=''; if(n!=='all' && window.cachedCats){ let t=window.cachedCats.find(c=>c.name===n); if(t&&t.subs&&t.subs.length>0){ sc.innerHTML='<span class="active-sub" onclick="window.filterBySub(\'all\',this)">الكل</span>'; t.subs.forEach(s=>sc.innerHTML+=`<span onclick="window.filterBySub('${s}',this)">${s}</span>`); } } loadProductsUser(n,'all'); }
window.filterBySub = function(s,el){ document.querySelectorAll('#subCategoriesTabs span').forEach(x=>x.classList.remove('active-sub')); el.classList.add('active-sub'); loadProductsUser(currentMainCat,s); }
window.closeModal = function() { document.getElementById('productModal').style.display='none'; }
window.addToCart = function(type) { if(!currentProduct)return; let cart=JSON.parse(localStorage.getItem('shamma_cart'))||[]; cart.push({id:Date.now(), productId:currentProduct.id, productName:currentProduct.name, price:document.getElementById('mPrice').innerText, type:type==='buy'?'شراء':'حجز'}); localStorage.setItem('shamma_cart',JSON.stringify(cart)); window.closeModal(); window.updateCartCount(); window.toggleCart(); }
window.prepareDirectOrder = function(type) { currentProduct.tempType = type; window.closeModal(); window.openCheckoutModal(); }
window.openCheckoutModal = function() { document.getElementById('checkoutModal').style.display='block'; let profile = JSON.parse(localStorage.getItem('shamma_user_profile')); if(profile) { document.getElementById('cName').value = profile.name; document.getElementById('cPhone').value = profile.phone; document.getElementById('cAddress').value = profile.address; } }
window.closeCheckoutModal = function() { document.getElementById('checkoutModal').style.display='none'; }
window.openProfileModal = function() { document.getElementById('profileModal').style.display='block'; loadUserProfile(); window.loadUserLogs(); }
window.closeProfileModal = function() { document.getElementById('profileModal').style.display='none'; }
window.toggleProfileEdit = function() { const v=document.getElementById('profileViewMode'); const e=document.getElementById('profileEditMode'); if(v.style.display==='none'){v.style.display='block';e.style.display='none';}else{v.style.display='none';e.style.display='block';loadUserProfileToForm();} }
window.saveProfileData = function(e) { e.preventDefault(); const p={name:document.getElementById('editName').value, phone:document.getElementById('editPhone').value, address:document.getElementById('editAddress').value}; localStorage.setItem('shamma_user_profile', JSON.stringify(p)); window.toggleProfileEdit(); loadUserProfile(); alert('تم الحفظ'); }
function loadUserProfile() { let p=JSON.parse(localStorage.getItem('shamma_user_profile')); if(p){ document.getElementById('profileNameDisplay').innerText=p.name; document.getElementById('viewName').innerText=p.name; document.getElementById('viewPhone').innerText=p.phone; document.getElementById('viewAddress').innerText=p.address; } }
function loadUserProfileToForm() { let p=JSON.parse(localStorage.getItem('shamma_user_profile')); if(p){ document.getElementById('editName').value=p.name; document.getElementById('editPhone').value=p.phone; document.getElementById('editAddress').value=p.address; } }
window.toggleCart = function(){ let s=document.getElementById('cartSidebar'); let o=document.getElementById('cartOverlay'); if(s.classList.contains('open')){s.classList.remove('open');o.style.display='none';}else{s.classList.add('open');o.style.display='block'; window.loadCart();}}
window.loadCart = function(){ let c=JSON.parse(localStorage.getItem('shamma_cart'))||[]; let d=document.getElementById('cartItems'); let t=document.getElementById('totalPrice'); d.innerHTML=''; let sum=0; if(c.length===0){d.innerHTML='<p>فارغة</p>';t.innerText='0';return;} c.forEach(i=>{ let p=parseFloat(i.price.replace(/[^0-9.]/g,'')); if(!isNaN(p))sum+=p; d.innerHTML+=`<div class="cart-item"><div><b>${i.productName}</b><br><small>${i.type}</small></div><b>${i.price}</b></div>`;}); t.innerText=Math.floor(sum)+" ج.م"; }
window.updateCartCount = function(){ let c=JSON.parse(localStorage.getItem('shamma_cart'))||[]; document.getElementById('cartCount').innerText=c.length;}
window.scrollToProducts = function() { document.getElementById('homeSection').scrollIntoView({ behavior: 'smooth' }); }
window.populateCategorySelects = async function() { const p=document.getElementById('pCategory'); if(!p)return; const s = await getDocs(collection(db, "categories")); p.innerHTML='<option value="" disabled selected>اختر القسم</option>'; s.docs.forEach((doc)=>{ let d=doc.data(); p.innerHTML+=`<option value="${doc.id}">${d.name}</option>`; }); }
window.updateSubCatsSelect = async function() { document.getElementById('pSubCategory').innerHTML='<option value="عام">عام</option>'; }
