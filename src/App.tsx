// @ts-nocheck
import React, { useState, useMemo, useEffect } from 'react';
import { 
  Search, Package, Clock, CheckCircle, CheckSquare,
  Square, List, Box, Layers, Wifi,
  FileText, Check, AlertOctagon, X, PackageOpen, LayoutGrid, ArchiveRestore
} from 'lucide-react';

// === IMPORTAÇÕES DO BANCO DE DADOS (FIREBASE) ===
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';

// ==========================================================
// CONFIGURAÇÃO OFICIAL DO SEU FIREBASE
// ==========================================================
const firebaseConfig = {
  apiKey: "AIzaSyAGgctmCHkKK6ZQKJhECEScxszpCIZmImM",
  authDomain: "painel-shopee-7e04f.firebaseapp.com",
  databaseURL: "https://painel-shopee-7e04f-default-rtdb.firebaseio.com",
  projectId: "painel-shopee-7e04f",
  storageBucket: "painel-shopee-7e04f.firebasestorage.app",
  messagingSenderId: "767069412945",
  appId: "1:767069412945:web:a5fa2e29d21c3348122270"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = "painel-shopee-7e04f"; 

export default function App() {
  const [orders, setOrders] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('summary'); 
  
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  
  const [user, setUser] = useState(null);
  const [checkedItemsMap, setCheckedItemsMap] = useState({}); 
  const [showBatchModal, setShowBatchModal] = useState(false);

  useEffect(() => {
    if (!auth) return;
    signInAnonymously(auth).catch(console.error);
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !db) return;
    const checksRef = collection(db, 'artifacts', appId, 'public', 'shopee_checks');
    const unsubChecks = onSnapshot(checksRef, (snapshot) => {
      const newMap = {};
      snapshot.forEach(doc => { newMap[doc.data().key] = doc.id; });
      setCheckedItemsMap(newMap);
    });

    const ordersRef = doc(db, 'artifacts', appId, 'public', 'shopee_active_orders');
    const unsubOrders = onSnapshot(ordersRef, (docSnap) => {
      if (docSnap.exists() && docSnap.data().orders_list) {
        setOrders(docSnap.data().orders_list);
      }
    });

    return () => { unsubChecks(); unsubOrders(); };
  }, [user]);

  const checkedItems = useMemo(() => new Set(Object.keys(checkedItemsMap)), [checkedItemsMap]);

  const parseCSV = (text) => {
    const cleanText = text.replace(/^\uFEFF/, '');
    const lines = cleanText.split(/\r?\n/);
    if (lines.length < 2) return [];
    const firstLine = lines[0];
    let delimiter = ',';
    if ((firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length) delimiter = ';';

    const headers = lines[0].split(delimiter).map(h => h.replace(/^["']|["']$/g, '').trim());
    const result = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const row = lines[i].split(delimiter).map(val => val.replace(/^["']|["']$/g, '').trim());
      const obj = {};
      headers.forEach((header, index) => { obj[header] = row[index] || ''; });
      result.push(obj);
    }
    return result;
  };

  const processData = async (parsedData) => {
    const superNormalize = (str) => String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    const mappedOrders = parsedData.map((row, index) => {
      const getVal = (keywords) => {
        const key = Object.keys(row).find(k => keywords.some(kw => superNormalize(k).includes(superNormalize(kw))));
        return key ? row[key] : '';
      };
      const id = getVal(['numero', 'pedido', 'orderid']);
      const product = getVal(['descri', 'produto', 'product']);
      const sku = getVal(['sku', 'codigo']); 
      const buyer = getVal(['contato', 'usuario', 'comprador', 'cliente', 'nome']);
      const qty = parseInt(getVal(['quant', 'qtd'])) || 1;

      return { rowKey: `${id}-${product}-${sku || 'nosku'}`, id, product, sku, quantity: qty, buyer, timestamp: index };
    }).filter(o => o.id);

    const orderCounts = {};
    mappedOrders.forEach(o => { orderCounts[o.id] = (orderCounts[o.id] || 0) + 1; });
    const finalOrders = mappedOrders.map(o => ({ ...o, itemsInOrder: orderCounts[o.id] }));

    if (finalOrders.length === 0) {
      setError('O arquivo foi lido, mas as colunas de pedidos não foram encontradas.');
      setIsUploading(false);
      return;
    }

    if (db && user) {
      try {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'shopee_active_orders'), { orders_list: finalOrders });
        setError('');
        setActiveTab('summary'); 
      } catch (err) { setError('Erro ao sincronizar com o servidor.'); }
    }
    setIsUploading(false);
  };

  const onDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
  const onDrop = (e) => {
    e.preventDefault(); setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) handleFileUpload(e.dataTransfer.files[0]);
  };
  const handleFileInput = (e) => {
    if (e.target.files && e.target.files.length > 0) handleFileUpload(e.target.files[0]);
  };

  const handleFileUpload = (file) => {
    setIsUploading(true); setError('');
    const reader = new FileReader();
    reader.onload = (event) => { processData(parseCSV(event.target.result)); };
    reader.readAsText(file);
  };

  const toggleCheck = async (rowKey) => {
    if (!user || !db) return;
    const docId = checkedItemsMap[rowKey]; 
    try {
      if (docId) await deleteDoc(doc(db, 'artifacts', appId, 'public', 'shopee_checks', docId));
      else await setDoc(doc(collection(db, 'artifacts', appId, 'public', 'shopee_checks')), { key: rowKey });
    } catch (err) {}
  };

  const filteredOrders = useMemo(() => {
    return orders.filter(order => 
      order.id.toLowerCase().includes(searchQuery.toLowerCase()) || 
      order.buyer.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.product.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (order.sku && order.sku.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  }, [orders, searchQuery]);

  const sortedAndFilteredOrders = useMemo(() => {
    return [...filteredOrders].sort((a, b) => {
      const aIsMulti = a.itemsInOrder > 1;
      const bIsMulti = b.itemsInOrder > 1;
      if (aIsMulti && !bIsMulti) return 1;
      if (!aIsMulti && bIsMulti) return -1;
      if (a.id === b.id) return String(a.sku || '').localeCompare(String(b.sku || ''));
      return a.timestamp - b.timestamp;
    });
  }, [filteredOrders]);

  const pendingOrdersList = useMemo(() => sortedAndFilteredOrders.filter(o => !checkedItems.has(o.rowKey)), [sortedAndFilteredOrders, checkedItems]);
  
  const palletStatus = useMemo(() => {
    const map = {};
    orders.forEach(o => {
      if (!map[o.id]) map[o.id] = { id: o.id, buyer: o.buyer, totalRows: 0, checkedRows: 0, items: [] };
      map[o.id].totalRows += 1;
      map[o.id].items.push(o);
      if (checkedItems.has(o.rowKey)) map[o.id].checkedRows += 1;
    });

    const completeBoxes = Object.values(map).filter(o => o.totalRows === o.checkedRows && o.totalRows > 0);
    const incompleteBoxes = Object.values(map).filter(o => o.checkedRows > 0 && o.checkedRows < o.totalRows);
    
    return { completeBoxes, incompleteBoxes, totalExpectedBoxes: Object.keys(map).length };
  }, [orders, checkedItems]);

  const packagingStats = useMemo(() => {
    const orderTotals = {};
    orders.forEach(o => {
      if (!orderTotals[o.id]) orderTotals[o.id] = 0;
      orderTotals[o.id] += o.quantity;
    });
    let singleBoxCount = 0; let multiBoxCount = 0;
    Object.values(orderTotals).forEach(totalQty => {
      if (totalQty === 1) singleBoxCount++; else if (totalQty > 1) multiBoxCount++;
    });
    return { totalPackages: singleBoxCount + multiBoxCount, singleBoxCount, multiBoxCount };
  }, [orders]);

  const productSummary = useMemo(() => {
    const summary = {};
    orders.forEach(order => {
      const isChecked = checkedItems.has(order.rowKey);
      const skuKey = order.sku || order.product || 'Sem Identificação';
      if (!summary[skuKey]) summary[skuKey] = { sku: order.sku, name: order.product, totalQty: 0, pickedQty: 0 };
      summary[skuKey].totalQty += order.quantity;
      if (isChecked) summary[skuKey].pickedQty += order.quantity;
    });
    return Object.values(summary).sort((a, b) => b.totalQty - a.totalQty);
  }, [orders, checkedItems]);

  const handleBatchCheck = () => {
    if (!user || !db) return;
    pendingOrdersList.forEach(async (order) => {
      try { await setDoc(doc(collection(db, 'artifacts', appId, 'public', 'shopee_checks')), { key: order.rowKey }); } catch (err) {}
    });
    setShowBatchModal(false); setSearchQuery(''); 
  };

  const handleDesfazerCaixa = async (box) => {
    if (!user || !db) return;
    box.items.forEach(async (item) => {
      const docId = checkedItemsMap[item.rowKey];
      if (docId) {
        try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'shopee_checks', docId)); } catch (err) {}
      }
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 font-sans text-gray-800">
      
      {showBatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="bg-orange-500 p-4 flex justify-between items-center text-white">
              <div className="flex items-center gap-2 font-bold text-lg"><AlertOctagon size={24} />Atenção: Ação em Lote</div>
              <button onClick={() => setShowBatchModal(false)} className="hover:bg-orange-600 p-1 rounded-full"><X size={20} /></button>
            </div>
            <div className="p-6">
              <p className="text-gray-600 text-base leading-relaxed">Você está prestes a marcar <strong className="text-gray-900 text-lg">{pendingOrdersList.length} pedidos</strong> como <strong className="text-emerald-600">PRONTOS</strong>.</p>
            </div>
            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setShowBatchModal(false)} className="px-5 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-200 rounded-lg">Cancelar</button>
              <button onClick={handleBatchCheck} className="px-5 py-2.5 text-sm font-bold text-white bg-orange-500 hover:bg-orange-600 rounded-lg flex items-center gap-2"><Check size={18} /> Confirmar</button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="bg-orange-500 text-white p-2 rounded-lg relative">
              <Package size={24} />
              {user && <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 border-2 border-white rounded-full"></span>}
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Separação de Pedidos</h1>
              <p className="text-sm text-gray-500 flex items-center gap-1">
                <Wifi size={14} className={user ? "text-emerald-500" : "text-gray-400"} />
                {user ? "Sistema Multi-usuário (Online)" : "Conectando ao servidor..."}
              </p>
            </div>
          </div>
        </div>

        {error && <div className="p-4 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">{error}</div>}

        {orders.length === 0 ? (
           <div onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all ${isDragging ? 'border-orange-500 bg-orange-50' : 'border-gray-300 bg-white'}`}>
             <input type="file" accept=".csv" onChange={handleFileInput} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
             <div className="flex flex-col items-center pointer-events-none">
               <FileText className="text-gray-400 mb-3" size={40} />
               <p className="text-lg font-medium text-gray-700">Importar Pedidos do ERP</p>
               <p className="text-sm text-gray-500">Arraste seu arquivo CSV aqui.</p>
             </div>
           </div>
        ) : (
          <>
            <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
              <div className="flex border-b border-gray-100 bg-gray-50/50 overflow-x-auto">
                <button onClick={() => setActiveTab('summary')} className={`px-6 py-4 font-medium text-sm flex items-center gap-2 border-b-2 whitespace-nowrap ${activeTab === 'summary' ? 'border-orange-500 text-orange-600 bg-white' : 'border-transparent text-gray-500'}`}><LayoutGrid size={18}/> Resumo e Caixas</button>
                <button onClick={() => setActiveTab('pending')} className={`px-6 py-4 font-medium text-sm flex items-center gap-2 border-b-2 whitespace-nowrap ${activeTab === 'pending' ? 'border-orange-500 text-orange-600 bg-white' : 'border-transparent text-gray-500'}`}><List size={18}/> A Separar ({pendingOrdersList.length})</button>
                <button onClick={() => setActiveTab('ready')} className={`px-6 py-4 font-medium text-sm flex items-center gap-2 border-b-2 whitespace-nowrap ${activeTab === 'ready' ? 'border-emerald-500 text-emerald-600 bg-white' : 'border-transparent text-gray-500'}`}><CheckCircle size={18}/> Pallet Prontos ({palletStatus.completeBoxes.length})</button>
              </div>

              <div className="p-4 md:p-6 bg-gray-50/30">
                
                {activeTab === 'summary' && (
                  <div className="space-y-8 animate-in fade-in duration-300">
                    <div>
                      <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><Box className="text-orange-500" /> Preparação de Embalagens</h2>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                          <p className="text-sm font-medium text-gray-500 mb-1">Total de Pacotes (Etiquetas)</p>
                          <p className="text-3xl font-black text-gray-900">{packagingStats.totalPackages}</p>
                        </div>
                        <div className="bg-blue-50 p-5 rounded-xl border border-blue-100 shadow-sm">
                          <p className="text-sm font-medium text-blue-700 mb-1">Caixas Individuais (1 item)</p>
                          <p className="text-3xl font-black text-blue-900">{packagingStats.singleBoxCount}</p>
                        </div>
                        <div className="bg-purple-50 p-5 rounded-xl border border-purple-100 shadow-sm">
                          <p className="text-sm font-medium text-purple-700 mb-1">Caixas Múltiplas (2+ itens)</p>
                          <p className="text-3xl font-black text-purple-900">{packagingStats.multiBoxCount}</p>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><PackageOpen className="text-orange-500" /> Lista de Coleta (Estoque)</h2>
                      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
                            <tr>
                              <th className="px-6 py-3 font-bold">Produto</th>
                              <th className="px-6 py-3 font-bold text-center w-32">Separados</th>
                              <th className="px-6 py-3 font-bold text-center w-32">Pegar Físico</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {productSummary.map((item, idx) => {
                              const remaining = item.totalQty - item.pickedQty;
                              const isDone = remaining === 0;
                              return (
                                <tr key={idx} className={`hover:bg-gray-50 transition-colors ${isDone ? 'opacity-50 bg-gray-50' : ''}`}>
                                  <td className="px-6 py-4">
                                    <p className={`font-bold ${isDone ? 'line-through text-gray-500' : 'text-gray-800'}`}>{item.name}</p>
                                    <p className="text-xs text-gray-400 font-mono mt-0.5">SKU: {item.sku}</p>
                                  </td>
                                  <td className="px-6 py-4 text-center font-medium text-emerald-600 bg-emerald-50/30">{item.pickedQty} / {item.totalQty}</td>
                                  <td className="px-6 py-4 text-center">
                                    {isDone ? <span className="inline-block px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold">Concluído</span> : <span className="inline-block px-3 py-1 bg-orange-100 text-orange-700 rounded-md text-sm font-black border border-orange-200 shadow-sm">{remaining}x</span>}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'pending' && (
                  <div className="animate-in fade-in duration-300">
                    <div className="relative mb-4">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                      <input type="text" placeholder="Buscar por SKU ou Produto..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg bg-white shadow-sm focus:ring-2 focus:ring-orange-500 focus:outline-none" />
                    </div>

                    {searchQuery.length > 0 && pendingOrdersList.length > 1 && (
                      <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
                        <div className="flex items-center gap-2 text-blue-800">
                          <Layers size={20} className="text-blue-600" />
                          <span>Foram encontrados <strong>{pendingOrdersList.length} pedidos</strong> para "{searchQuery}".</span>
                        </div>
                        <button onClick={() => setShowBatchModal(true)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg shadow transition-colors whitespace-nowrap">Marcar todos como Prontos</button>
                      </div>
                    )}

                    {pendingOrdersList.map((order) => {
                      const isMulti = order.itemsInOrder > 1;
                      return (
                        <div key={order.rowKey} onClick={() => toggleCheck(order.rowKey)} className={`flex items-center p-4 mb-2 border rounded-xl cursor-pointer shadow-sm transition-all ${isMulti ? 'border-purple-200 bg-purple-50/80 hover:bg-purple-100' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
                          <Square className="text-gray-300 mr-4 flex-shrink-0" size={24} />
                          <div className="flex-1">
                             <p className="font-bold text-gray-900 text-[15px]">{order.product}</p>
                             <p className="text-xs text-gray-500 mt-1 font-medium">Pedido: <span className="font-mono">{order.id}</span> | Cliente: {order.buyer}</p>
                             {isMulti && <p className="text-xs font-bold text-purple-700 mt-1.5 flex items-center gap-1 bg-purple-100 inline-flex px-2 py-0.5 rounded"><Layers size={14}/> Vários itens neste pedido</p>}
                          </div>
                          <div className="font-black text-xl px-4 py-2 bg-white rounded-lg border border-gray-200 shadow-sm ml-3 text-gray-800">{order.quantity}x</div>
                        </div>
                      );
                    })}
                    {pendingOrdersList.length === 0 && <p className="text-center text-gray-500 py-10">Nenhum pedido pendente encontrado.</p>}
                  </div>
                )}

                {activeTab === 'ready' && (
                  <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="bg-emerald-50 border-2 border-emerald-500 rounded-xl p-6 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
                      <div>
                        <h2 className="text-emerald-800 font-bold text-xl flex items-center gap-2">
                          <CheckCircle className="text-emerald-500" size={28}/> 
                          Prova Real do Pallet
                        </h2>
                        <p className="text-emerald-700 mt-1">Conferência exata antes da transportadora coletar.</p>
                      </div>
                      <div className="text-center bg-white px-6 py-4 rounded-lg shadow-sm border border-emerald-100">
                        <p className="text-sm font-bold text-gray-500 mb-1">Pacotes físicos fechados</p>
                        <p className="text-4xl font-black text-emerald-600">
                          {palletStatus.completeBoxes.length} <span className="text-xl text-gray-400">/ {palletStatus.totalExpectedBoxes}</span>
                        </p>
                      </div>
                    </div>

                    {palletStatus.incompleteBoxes.length > 0 && (
                      <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl">
                        <h3 className="font-bold text-amber-800 flex items-center gap-2 mb-2"><AlertOctagon size={18}/> Pedidos Incompletos</h3>
                        <p className="text-sm text-amber-700 mb-3">Estes pedidos têm itens separados, mas ainda faltam outros para poder fechar a caixa.</p>
                        <div className="space-y-2">
                          {palletStatus.incompleteBoxes.map(box => (
                            <div key={box.id} className="text-sm bg-white p-2 rounded border border-amber-100 flex justify-between">
                              <span className="font-mono text-gray-600">{box.id} - {box.buyer}</span>
                              <span className="font-bold text-amber-600">{box.checkedRows} de {box.totalRows} itens bipados</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <h3 className="font-bold text-gray-700 mb-3">Histórico de Caixas Finalizadas</h3>
                      {palletStatus.completeBoxes.length === 0 ? (
                        <p className="text-center text-gray-500 py-10 bg-white rounded-xl border border-gray-200">Ainda não há nenhuma caixa fechada no pallet.</p>
                      ) : (
                        <div className="space-y-2">
                          {palletStatus.completeBoxes.map((box, index) => (
                            <div key={box.id} className="flex items-center p-3 border border-emerald-100 bg-white rounded-lg shadow-sm hover:bg-gray-50 transition-colors">
                              <div className="bg-emerald-100 text-emerald-700 font-black w-8 h-8 rounded-full flex items-center justify-center text-sm mr-4 flex-shrink-0">
                                {palletStatus.completeBoxes.length - index}
                              </div>
                              <div className="flex-1">
                                 <p className="font-bold text-gray-800 text-[15px]">{box.buyer}</p>
                                 <p className="text-xs text-gray-500 mt-0.5">Pedido: <span className="font-mono">{box.id}</span> • {box.totalRows} {box.totalRows === 1 ? 'item' : 'itens'}</p>
                              </div>
                              <button 
                                onClick={() => handleDesfazerCaixa(box)}
                                className="ml-3 text-red-500 hover:text-red-700 hover:bg-red-50 p-2 rounded-lg transition-colors flex items-center gap-1 text-xs font-bold"
                                title="Desfazer e voltar para A Separar"
                              >
                                <ArchiveRestore size={16} /> Desfazer
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}