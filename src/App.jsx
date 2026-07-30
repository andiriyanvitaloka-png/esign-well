import { useState, useEffect, useRef } from 'react'
import './App.css'
import { supabase } from './supabase'
import { Document, Page, pdfjs } from 'react-pdf'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import emailjs from '@emailjs/browser'

import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

function App() {
  const [doc, setDoc] = useState(null)
  const [allDocuments, setAllDocuments] = useState([])
  const [recipients, setRecipients] = useState([])
  const [fields, setFields] = useState([])
  const [selectedRecipientId, setSelectedRecipientId] = useState('')
  const [fieldType, setFieldType] = useState('signature')
  const [activeSigner, setActiveSigner] = useState(null)
  const [fieldInputs, setFieldInputs] = useState({})
  
  const [numPages, setNumPages] = useState(null)
  const [activeFieldIndex, setActiveFieldIndex] = useState(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)

  // Flag apakah pengguna membuka aplikasi via link email khusus
  const [isSignerOnlyView, setIsSignerOnlyView] = useState(false)

  // Mode & UI States
  const [mode, setMode] = useState('dashboard')
  const [filter, setFilter] = useState('All') // Filter untuk Dashboard
  const [searchQuery, setSearchQuery] = useState('') // Fitur Search Baru
  const [activeDropdown, setActiveDropdown] = useState(null) // State Dropdown

  // State Form Upload Baru
  const [file, setFile] = useState(null)
  const [signerList, setSignerList] = useState([
    { name: '', email: '' },
    { name: '', email: '' },
    { name: '', email: '' }
  ])
  const [isUploading, setIsUploading] = useState(false)

  const isDragging = useRef(false)
  const dragStartPos = useRef({ x: 0, y: 0 })

  useEffect(() => {
    loadDocumentData()
    fetchAllDocumentsList()
  }, [])

  // AMBIL SEMUA DOKUMEN UNTUK DASHBOARD ADMIN
  async function fetchAllDocumentsList() {
    const { data: docsData } = await supabase
      .from('documents')
      .select('*, recipients(*)')
      .order('created_at', { ascending: false })

    if (docsData) {
      setAllDocuments(docsData)
    }
  }

  // FUNGSI UNTUK MENGHAPUS DOKUMEN
  const handleDeleteDocument = async (docId, fileUrl) => {
    if (!window.confirm("Apakah Anda yakin ingin menghapus dokumen ini?")) return;

    try {
      const { error: dbError } = await supabase
        .from('documents')
        .delete()
        .eq('id', docId)

      if (dbError) throw dbError

      if (fileUrl) {
        const urlParts = fileUrl.split('/')
        const fileName = urlParts[urlParts.length - 1]
        if (fileName) {
          await supabase.storage.from('pdf_documents').remove([`documents/${fileName}`])
        }
      }

      alert("Dokumen berhasil dihapus! 🗑️")
      await fetchAllDocumentsList()
    } catch (error) {
      console.error("Gagal menghapus dokumen:", error)
      alert("Gagal menghapus dokumen: " + error.message)
    }
  }

  // FUNGSI REMINDER EMAIL
  const handleSendReminder = async (d) => {
    const pendingSigner = d.recipients?.find(r => r.status === 'Mailed')
    if (!pendingSigner) {
      alert("Tidak ada Signer yang sedang menunggu giliran tanda tangan saat ini.")
      return
    }

    if (!window.confirm(`Kirim email pengingat (reminder) ke ${pendingSigner.name} (${pendingSigner.email})?`)) return;

    sendSigningNotificationEmail(pendingSigner.name, pendingSigner.email, d.filename)
    alert(`Email pengingat berhasil dikirimkan ulang ke ${pendingSigner.name}! 🔔`)
  }

  // FUNGSI CANCEL REQUEST E-SIGN
  const handleCancelRequest = async (docId) => {
    if (!window.confirm("Apakah Anda yakin ingin MEMBATALKAN seluruh permintaan tanda tangan untuk dokumen ini?")) return;

    try {
      const { error: docErr } = await supabase
        .from('documents')
        .update({ status: 'CANCELLED' })
        .eq('id', docId)

      if (docErr) throw docErr

      await supabase
        .from('recipients')
        .update({ status: 'Cancelled' })
        .eq('document_id', docId)
        .neq('status', 'Signed')

      alert("Permintaan E-Signature berhasil dibatalkan! 🚫")
      await fetchAllDocumentsList()
    } catch (err) {
      alert("Gagal membatalkan permintaan: " + err.message)
    }
  }

  async function loadDocumentData(targetDocId = null) {
    let query = supabase.from('documents').select('*')
    
    if (targetDocId) {
      query = query.eq('id', targetDocId)
    } else {
      query = query.order('created_at', { ascending: false }).limit(1)
    }

    const { data: docData } = await query.single()

    if (docData) {
      setDoc(docData)

      const { data: recData } = await supabase
        .from('recipients')
        .select('*')
        .eq('document_id', docData.id)
        .order('signing_order', { ascending: true })

      if (recData && recData.length > 0) {
        setRecipients(recData)
        setSelectedRecipientId(recData[0].id)

        const queryParams = new URLSearchParams(window.location.search)
        const urlMode = queryParams.get('mode')
        const urlEmail = queryParams.get('email')

        if (urlMode === 'signing' && urlEmail) {
          const matchedSigner = recData.find(r => r.email.toLowerCase() === urlEmail.toLowerCase())
          if (matchedSigner) {
            setActiveSigner(matchedSigner)
            setMode('signing')
            setIsSignerOnlyView(true)
          } else {
            const currentTurn = recData.find(r => r.status === 'Mailed') || recData[0]
            setActiveSigner(currentTurn)
          }
        } else {
          const currentTurn = recData.find(r => r.status === 'Mailed') || recData[0]
          setActiveSigner(currentTurn)
        }
      }

      const { data: fieldData } = await supabase
        .from('document_fields')
        .select('*')
        .eq('document_id', docData.id)

      if (fieldData) {
        setFields(fieldData)
        
        const initialInputs = {}
        fieldData.forEach(f => {
          if (f.field_value) {
            initialInputs[f.id] = f.field_value
          }
        })
        setFieldInputs(initialInputs)
      }
    }
  }

  // --- FUNGSI PENGIRIMAN EMAIL ---
  const sendSigningNotificationEmail = (signerName, signerEmail, documentName) => {
    const directSigningLink = `${window.location.origin}/?mode=signing&email=${encodeURIComponent(signerEmail)}`

    const templateParams = {
      to_name: signerName,
      to_email: signerEmail,
      document_name: documentName,
      signing_link: directSigningLink
    }

    emailjs.send(
      'service_zbpxi9e',   
      'template_41gdynq',  
      templateParams,
      '3IVexZ_5CRpEngvvd'    
    )
    .then((response) => {
      console.log('✅ Email notifikasi berhasil dikirim', response.status, response.text)
    })
    .catch((err) => {
      console.error('❌ Gagal mengirim email notifikasi:', err)
    })
  }

  const handleSignerChange = (index, field, value) => {
    const updated = [...signerList]
    updated[index][field] = value
    setSignerList(updated)
  }

  const addSignerRow = () => {
    setSignerList([...signerList, { name: '', email: '' }])
  }

  const removeSignerRow = (index) => {
    if (signerList.length <= 1) return
    setSignerList(signerList.filter((_, i) => i !== index))
  }

  const handleUploadSubmit = async (e) => {
    e.preventDefault()
    if (!file) {
      alert("Harap pilih file PDF terlebih dahulu!")
      return
    }

    setIsUploading(true)
    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `${Date.now()}.${fileExt}`
      const filePath = `documents/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('pdf_documents')
        .upload(filePath, file)

      if (uploadError) throw uploadError

      const { data: urlData } = supabase.storage
        .from('pdf_documents')
        .getPublicUrl(filePath)

      const publicUrl = urlData.publicUrl

      const { data: newDoc, error: docError } = await supabase
        .from('documents')
        .insert([{ filename: file.name, file_url: publicUrl, status: 'IN_PROGRESS' }])
        .select()
        .single()

      if (docError) throw docError

      const recipientsPayload = signerList.map((s, index) => ({
        document_id: newDoc.id,
        name: s.name,
        email: s.email,
        signing_order: index + 1,
        status: index === 0 ? 'Mailed' : 'Waiting'
      }))

      const { error: recError } = await supabase
        .from('recipients')
        .insert(recipientsPayload)

      if (recError) throw recError

      if (signerList.length > 0) {
        sendSigningNotificationEmail(signerList[0].name, signerList[0].email, file.name)
      }

      alert("Berhasil mengunggah dokumen & mendaftarkan Signer baru! 🎉")
      setFile(null)
      setFieldInputs({})
      await fetchAllDocumentsList()
      await loadDocumentData(newDoc.id)
      setMode('plotting')

    } catch (err) {
      alert("Gagal mengunggah: " + err.message)
    } finally {
      setIsUploading(false)
    }
  }

  // --- LOGIKA PLOTTING ---
  const handleAddBox = (pageNo) => {
    const signerAktif = recipients.find(r => r.id === selectedRecipientId)
    if (!signerAktif) {
      alert("Harap pilih Signer terlebih dahulu!")
      return
    }

    const newField = {
      id: Date.now(),
      recipient_id: signerAktif.id,
      recipient_email: signerAktif.email,
      signing_order: signerAktif.signing_order,
      field_type: fieldType,
      page_number: pageNo,
      x_position: 20,
      y_position: 20,
      width: fieldType === 'text' ? 300 : 180,
      height: fieldType === 'text' ? 80 : 45
    }

    setFields([...fields, newField])
    setActiveFieldIndex(fields.length)
  }

  const handleMouseDown = (e, index) => {
    e.stopPropagation()
    setActiveFieldIndex(index)
    isDragging.current = true
    dragStartPos.current = { x: e.clientX, y: e.clientY }
  }

  const handleMouseMove = (e, pageWidth, pageHeight) => {
    if (!isDragging.current || activeFieldIndex === null) return

    const deltaX = e.clientX - dragStartPos.current.x
    const deltaY = e.clientY - dragStartPos.current.y
    dragStartPos.current = { x: e.clientX, y: e.clientY }

    setFields(prev => {
      const updated = [...prev]
      const target = updated[activeFieldIndex]
      if (!target) return prev

      const percentX = (deltaX / pageWidth) * 100
      const percentY = (deltaY / pageHeight) * 100

      target.x_position = Math.min(Math.max(target.x_position + percentX, 0), 85)
      target.y_position = Math.min(Math.max(target.y_position + percentY, 0), 92)
      return updated
    })
  }

  const handleMouseUp = () => {
    isDragging.current = false
  }

  const updateActiveField = (key, delta) => {
    if (activeFieldIndex === null) return
    setFields(prev => {
      const updated = [...prev]
      const target = updated[activeFieldIndex]
      if (target) {
        target[key] = Math.max(target[key] + delta, 20)
      }
      return updated
    })
  }

  const removeField = (index) => {
    setFields(fields.filter((_, i) => i !== index))
    if (activeFieldIndex === index) setActiveFieldIndex(null)
  }

  const handleSaveFields = async () => {
    if (fields.length === 0) {
      alert("Belum ada kotak yang ditambahkan!")
      return
    }

    setIsSaving(true)
    try {
      await supabase.from('document_fields').delete().eq('document_id', doc.id)

      const payload = fields.map(f => ({
        document_id: doc.id,
        recipient_email: f.recipient_email,
        field_type: f.field_type,
        page_number: f.page_number,
        x_position: f.x_position,
        y_position: f.y_position,
        width: f.width,
        height: f.height
      }))

      const { error } = await supabase.from('document_fields').insert(payload)
      if (error) throw error

      alert("Posisi & Ukuran Kotak Berhasil Disimpan! 🎯")
      await loadDocumentData(doc.id)
      await fetchAllDocumentsList()
      setMode('signing')

    } catch (err) {
      alert("Gagal menyimpan: " + err.message)
    } finally {
      setIsSaving(false)
    }
  }

  const handleInputChange = (fieldId, value) => {
    setFieldInputs(prev => ({
      ...prev,
      [fieldId]: value
    }))
  }

  const handleFinishSigning = async () => {
    if (!activeSigner) return

    const myFields = fields.filter(f => f.recipient_email === activeSigner.email)
    const emptyFields = myFields.filter(f => !fieldInputs[f.id] || fieldInputs[f.id].trim() === '')

    if (emptyFields.length > 0) {
      alert(`Harap isi semua kolom Tanda Tangan & Teks milik Anda (${activeSigner.name})!`)
      return
    }

    setIsSubmitting(true)
    try {
      const summaryText = myFields.map(f => fieldInputs[f.id]).join("\n\n")

      const { error: updateError } = await supabase
        .from('recipients')
        .update({ status: 'Signed', conclusion: summaryText })
        .eq('id', activeSigner.id)

      if (updateError) throw updateError

      for (const f of myFields) {
        await supabase
          .from('document_fields')
          .update({ field_value: fieldInputs[f.id] })
          .eq('id', f.id)
      }

      const nextOrder = activeSigner.signing_order + 1
      const nextSigner = recipients.find(r => r.signing_order === nextOrder)

      if (nextSigner) {
        await supabase.from('recipients').update({ status: 'Mailed' }).eq('id', nextSigner.id)
        sendSigningNotificationEmail(nextSigner.name, nextSigner.email, doc.filename)
      }

      alert(`Terima kasih ${activeSigner.name}, dokumen Anda berhasil disimpan! 🎉`)
      await loadDocumentData(doc.id)
      await fetchAllDocumentsList()

    } catch (err) {
      alert("Gagal menyimpan: " + err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  // --- DOWNLOAD PDF FINAL ---
  const handleDownloadFinalPdf = async () => {
    setIsDownloading(true)
    try {
      const existingPdfBytes = await fetch(doc.file_url).then(res => res.arrayBuffer())

      const pdfDoc = await PDFDocument.load(existingPdfBytes)
      const helveticaRegular = await pdfDoc.embedFont(StandardFonts.Helvetica)
      const pages = pdfDoc.getPages()

      fields.forEach(f => {
        const pageIndex = (f.page_number || 1) - 1
        const pdfPage = pages[pageIndex]
        if (!pdfPage) return

        const { width: pdfWidth, height: pdfHeight } = pdfPage.getSize()
        const scaleRatio = pdfWidth / 800;

        const xPos = (f.x_position / 100) * pdfWidth
        const yTop = pdfHeight - ((f.y_position / 100) * pdfHeight)
        
        const boxWidthPx = f.width || (f.field_type === 'text' ? 300 : 180)
        const boxHeightPx = f.height || (f.field_type === 'text' ? 80 : 45)
        
        const boxHeightPdf = boxHeightPx * scaleRatio
        const boxWidthPdf = boxWidthPx * scaleRatio
        
        const textToDraw = fieldInputs[f.id] || ''
        
        let finalFontSize = f.field_type === 'signature' ? 14 : 11;
        
        if (f.field_type === 'signature' && textToDraw) {
            const textWidth = helveticaRegular.widthOfTextAtSize(textToDraw, finalFontSize);
            const maxTextWidthPdf = boxWidthPdf - (12 * scaleRatio); 
            
            if (textWidth > maxTextWidthPdf) {
                finalFontSize = finalFontSize * (maxTextWidthPdf / textWidth);
            }
            finalFontSize = Math.min(finalFontSize, boxHeightPdf * 0.6);
        }

        const textLines = textToDraw.split('\n').length
        const totalTextHeight = textLines * (finalFontSize * 1.2)
        const yPosCenter = yTop - (boxHeightPdf / 2) + (totalTextHeight / 2) - finalFontSize

        if (textToDraw) {
          pdfPage.drawText(textToDraw, {
            x: xPos + (6 * scaleRatio), 
            y: yPosCenter, 
            size: finalFontSize,
            font: helveticaRegular,
            color: f.field_type === 'signature' ? rgb(0.1, 0.25, 0.7) : rgb(0.1, 0.1, 0.1),
            maxWidth: boxWidthPdf - (12 * scaleRatio), 
            lineHeight: finalFontSize * 1.2
          })
        }
      })

      const pdfBytes = await pdfDoc.save()
      const blob = new Blob([pdfBytes], { type: 'application/pdf' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `SIGNED_${doc.filename}`
      link.click()

      alert("Dokumen PDF Berhasil Diunduh! 📥")
    } catch (err) {
      alert("Gagal mengunduh PDF: " + err.message)
    } finally {
      setIsDownloading(false)
    }
  }

  // LOGIKA FILTER & SEARCH DOKUMEN DI DASHBOARD
  const filteredDocuments = allDocuments.filter((d) => {
    const isAllSigned = d.recipients && d.recipients.length > 0 && d.recipients.every(r => r.status === 'Signed')
    const isDocCancelled = d.status === 'CANCELLED'

    // 1. Cek berdasarkan Tab Status
    let passFilter = true
    if (filter === 'Completed') passFilter = isAllSigned
    else if (filter === 'Cancelled') passFilter = isDocCancelled
    else if (filter === 'In Progress') passFilter = !isAllSigned && !isDocCancelled

    // 2. Cek berdasarkan Kata Kunci Pencarian (Search)
    let passSearch = true
    if (searchQuery.trim() !== '') {
      const lowerQuery = searchQuery.toLowerCase()
      // Cocokkan nama file dokumen
      const matchName = d.filename.toLowerCase().includes(lowerQuery)
      // Cocokkan alamat email recipients (jika ada salah satu yang cocok)
      const matchEmail = d.recipients?.some(r => r.email.toLowerCase().includes(lowerQuery))
      
      passSearch = matchName || matchEmail
    }

    // Dokumen harus lolos kedua syarat di atas agar tampil
    return passFilter && passSearch
  })

  const completedCount = recipients.filter(r => r.status === 'Signed').length
  const progressPercent = recipients.length > 0 ? Math.round((completedCount / recipients.length) * 100) : 0
  const activeBox = activeFieldIndex !== null ? fields[activeFieldIndex] : null
  const isCancelled = doc?.status === 'CANCELLED'

  return (
    <div className="app-container" onMouseUp={handleMouseUp} style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#f3f4f6', fontFamily: "'Inter', sans-serif" }}>
      
      {/* SIDEBAR NAVIGATION */}
      {!isSignerOnlyView && (
        <div className="sidebar" style={{ width: '260px', backgroundColor: '#0f172a', color: 'white', padding: '24px', borderRight: '1px solid #1e293b', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '40px' }}>
            <img 
              src="/logo.png" 
              alt="Logo" 
              style={{ width: '36px', height: '36px', objectFit: 'contain', borderRadius: '8px' }} 
              onError={(e) => e.target.style.display = 'none'} 
            />
            <h2 style={{ fontSize: '24px', margin: 0, fontWeight: '800', background: 'linear-gradient(90deg, #38bdf8 0%, #818cf8 100%)', WebkitBackgroundClip: 'text', color: 'transparent', letterSpacing: '-0.5px' }}>
              E-Sign Well
            </h2>
          </div>

          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <li className={mode === 'dashboard' ? 'active' : ''} onClick={() => setMode('dashboard')} style={menuItemStyle(mode === 'dashboard')}>
              📁 All Documents
            </li>
            <li className={mode === 'upload' ? 'active' : ''} onClick={() => setMode('upload')} style={menuItemStyle(mode === 'upload')}>
              ➕ Upload Baru
            </li>
          </ul>
        </div>
      )}

      <div className="main-content" style={{ flex: 1, padding: '40px', display: 'flex', flexDirection: 'column', gap: '24px', overflowY: 'auto', minWidth: 0 }}>
        
        {/* TABEL DASHBOARD "ALL DOCUMENTS" */}
        {!isSignerOnlyView && mode === 'dashboard' && (
          <div style={{ backgroundColor: 'white', padding: '32px', borderRadius: '16px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)', border: '1px solid #e5e7eb' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '16px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '24px', color: '#111827', fontWeight: '700' }}>Semua Dokumen</h2>
                <p style={{ margin: '4px 0 0 0', color: '#6b7280', fontSize: '14px' }}>Kelola permintaan tanda tangan Anda di sini.</p>
              </div>
              <button 
                onClick={() => setMode('upload')}
                style={{ backgroundColor: '#10b981', color: 'white', border: 'none', padding: '12px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', boxShadow: '0 4px 6px rgba(16, 185, 129, 0.2)', transition: 'all 0.2s', whiteSpace: 'nowrap' }}
              >
                + Upload New Document
              </button>
            </div>

            {/* TAB FILTER OPTIONS & SEARCH BAR */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '24px', borderBottom: '1px solid #e5e7eb', flexWrap: 'wrap', gap: '16px' }}>
              
              <div style={{ display: 'flex', gap: '24px', overflowX: 'auto' }}>
                {['All', 'In Progress', 'Completed', 'Cancelled'].map(f => (
                  <div
                    key={f}
                    onClick={() => setFilter(f)}
                    style={{
                      padding: '10px 4px',
                      cursor: 'pointer',
                      fontWeight: '600',
                      fontSize: '14px',
                      color: filter === f ? '#3b82f6' : '#64748b',
                      borderBottom: filter === f ? '2px solid #3b82f6' : '2px solid transparent',
                      marginBottom: '-1px',
                      transition: 'all 0.2s',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {f === 'All' ? 'Semua' : f}
                  </div>
                ))}
              </div>

              {/* KOLOM PENCARIAN (SEARCH BAR) */}
              <div style={{ marginBottom: '8px' }}>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: '14px' }}>🔍</span>
                  <input 
                    type="text" 
                    placeholder="Cari nama dokumen / email..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ 
                      padding: '8px 12px 8px 32px', 
                      borderRadius: '8px', 
                      border: '1px solid #cbd5e1', 
                      outline: 'none', 
                      fontSize: '13px', 
                      width: '250px',
                      color: '#334155',
                      transition: 'all 0.2s'
                    }}
                  />
                </div>
              </div>

            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', color: '#475569', textTransform: 'uppercase', fontSize: '12px', letterSpacing: '0.05em' }}>
                    <th style={{ padding: '16px', borderRadius: '8px 0 0 8px', fontWeight: '600', minWidth: '150px' }}>Document Name</th>
                    <th style={{ padding: '16px', fontWeight: '600', minWidth: '250px' }}>Recipient Emails</th>
                    <th style={{ padding: '16px', fontWeight: '600', minWidth: '120px' }}>Date Created</th>
                    <th style={{ padding: '16px', fontWeight: '600', minWidth: '120px' }}>Status</th>
                    <th style={{ padding: '16px', textAlign: 'center', borderRadius: '0 8px 8px 0', fontWeight: '600', width: '100px' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDocuments.map((d) => {
                    const isAllSigned = d.recipients && d.recipients.length > 0 && d.recipients.every(r => r.status === 'Signed')
                    const isDocCancelled = d.status === 'CANCELLED'

                    return (
                      <tr key={d.id} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background-color 0.2s' }}>
                        <td style={{ padding: '16px', fontWeight: '600', color: '#1e293b', wordBreak: 'break-word' }}>{d.filename}</td>
                        
                        <td style={{ padding: '16px', lineHeight: '1.5' }}>
                          {d.recipients && d.recipients.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              {d.recipients.sort((a, b) => a.signing_order - b.signing_order).map(r => {
                                let statusIcon = '🕒';
                                let badgeBg = '#f1f5f9';
                                let textColor = '#64748b';

                                if (r.status === 'Signed') {
                                  statusIcon = '✅';
                                  badgeBg = '#ecfdf5';
                                  textColor = '#059669';
                                } else if (r.status === 'Mailed') {
                                  statusIcon = '⏳';
                                  badgeBg = '#fffbeb';
                                  textColor = '#d97706';
                                } else if (r.status === 'Cancelled') {
                                  statusIcon = '🚫';
                                  badgeBg = '#fef2f2';
                                  textColor = '#dc2626';
                                }

                                return (
                                  <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px' }}>
                                    <span style={{ 
                                      backgroundColor: badgeBg, 
                                      padding: '2px 6px', 
                                      borderRadius: '4px', 
                                      fontSize: '11px', 
                                      color: textColor, 
                                      fontWeight: 'bold',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      minWidth: '24px',
                                      justifyContent: 'center',
                                      flexShrink: 0
                                    }} title={r.status}>
                                      {statusIcon}
                                    </span>
                                    <span style={{ 
                                      color: r.status === 'Mailed' ? '#1e293b' : '#64748b', 
                                      fontWeight: r.status === 'Mailed' ? '600' : '400', 
                                      textDecoration: r.status === 'Cancelled' ? 'line-through' : 'none',
                                      wordBreak: 'break-word',
                                      overflowWrap: 'anywhere'
                                    }}>
                                      {r.email}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <span style={{ color: '#64748b' }}>-</span>
                          )}
                        </td>

                        <td style={{ padding: '16px', color: '#64748b', whiteSpace: 'nowrap' }}>
                          {new Date(d.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                        <td style={{ padding: '16px' }}>
                          {isDocCancelled ? (
                            <span style={{ backgroundColor: '#fef2f2', color: '#991b1b', padding: '4px 10px', borderRadius: '9999px', fontWeight: '700', fontSize: '10px', border: '1px solid #fecaca', whiteSpace: 'nowrap', display: 'inline-block' }}>
                              🚫 CANCELLED
                            </span>
                          ) : isAllSigned ? (
                            <span style={{ backgroundColor: '#ecfdf5', color: '#065f46', padding: '4px 10px', borderRadius: '9999px', fontWeight: '700', fontSize: '10px', border: '1px solid #a7f3d0', whiteSpace: 'nowrap', display: 'inline-block' }}>
                              ✓ COMPLETED
                            </span>
                          ) : (
                            <span style={{ backgroundColor: '#fffbeb', color: '#92400e', padding: '4px 10px', borderRadius: '9999px', fontWeight: '700', fontSize: '10px', border: '1px solid #fde68a', whiteSpace: 'nowrap', display: 'inline-block' }}>
                              ⏳ IN PROGRESS
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '16px', textAlign: 'center' }}>
                          <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }} onMouseLeave={() => setActiveDropdown(null)}>
                            <button 
                              onClick={() => setActiveDropdown(activeDropdown === d.id ? null : d.id)}
                              style={{ backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap' }}
                            >
                              Aksi ▼
                            </button>

                            {activeDropdown === d.id && (
                              <div style={{ position: 'absolute', top: '100%', right: '0', marginTop: '4px', backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', zIndex: 10, width: '150px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                <button 
                                  onClick={async () => { await loadDocumentData(d.id); setMode('signing'); setActiveDropdown(null) }}
                                  style={dropdownItemStyle}
                                >
                                  Buka Portal
                                </button>
                                
                                {!isAllSigned && !isDocCancelled && (
                                  <>
                                    <button 
                                      onClick={() => { handleSendReminder(d); setActiveDropdown(null) }}
                                      style={dropdownItemStyle}
                                    >
                                      🔔 Reminder
                                    </button>
                                    <button 
                                      onClick={() => { handleCancelRequest(d.id); setActiveDropdown(null) }}
                                      style={{...dropdownItemStyle, color: '#ea580c'}}
                                    >
                                      🚫 Cancel
                                    </button>
                                  </>
                                )}
                                
                                <button 
                                  onClick={() => { handleDeleteDocument(d.id, d.file_url); setActiveDropdown(null) }}
                                  style={{...dropdownItemStyle, color: '#dc2626', borderTop: '1px solid #e2e8f0'}}
                                >
                                  🗑️ Hapus
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}

                  {filteredDocuments.length === 0 && (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8', fontSize: '15px' }}>
                        Tidak ada dokumen ditemukan.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* MODE 0: FORM UPLOAD DOKUMEN BARU */}
        {!isSignerOnlyView && mode === 'upload' && (
          <div style={{ backgroundColor: 'white', padding: '40px', borderRadius: '16px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', border: '1px solid #e5e7eb', maxWidth: '750px', margin: '0 auto', width: '100%' }}>
            <h2 style={{ fontSize: '24px', margin: '0 0 8px 0', color: '#111827' }}>Upload Dokumen & Atur Signer Baru</h2>
            <p style={{ color: '#6b7280', margin: '0 0 32px 0' }}>Pilih file PDF dan daftarkan Signer untuk memulai proses E-Signature.</p>

            <form onSubmit={handleUploadSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div>
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '8px', color: '#374151' }}>File PDF Dokumen:</label>
                <div style={{ border: '1px dashed #cbd5e1', padding: '20px', borderRadius: '8px', backgroundColor: '#f8fafc' }}>
                  <input 
                    type="file" 
                    accept="application/pdf" 
                    onChange={(e) => setFile(e.target.files[0])}
                    style={{ width: '100%', color: '#475569' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '12px', color: '#374151' }}>Daftar Antrean Signer (Berurutan):</label>
                
                {signerList.map((signer, i) => (
                  <div key={i} style={{ display: 'flex', gap: '12px', marginBottom: '12px', alignItems: 'center' }}>
                    <div style={{ backgroundColor: '#e0f2fe', color: '#0369a1', width: '30px', height: '30px', borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center', fontWeight: 'bold', fontSize: '14px', flexShrink: 0 }}>
                      {i + 1}
                    </div>
                    <input 
                      type="text" 
                      placeholder="Nama lengkap" 
                      value={signer.name}
                      onChange={(e) => handleSignerChange(i, 'name', e.target.value)}
                      required
                      style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none', minWidth: '100px' }}
                    />
                    <input 
                      type="email" 
                      placeholder="Alamat Email" 
                      value={signer.email}
                      onChange={(e) => handleSignerChange(i, 'email', e.target.value)}
                      required
                      style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none', minWidth: '100px' }}
                    />
                    {signerList.length > 1 && (
                      <button 
                        type="button" 
                        onClick={() => removeSignerRow(i)}
                        style={{ backgroundColor: 'transparent', color: '#ef4444', border: 'none', cursor: 'pointer', fontSize: '20px', padding: '4px', flexShrink: 0 }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}

                <button 
                  type="button" 
                  onClick={addSignerRow}
                  style={{ backgroundColor: '#f1f5f9', color: '#475569', border: '1px dashed #cbd5e1', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', marginTop: '8px', width: '100%' }}
                >
                  + Tambah Signer Berikutnya
                </button>
              </div>

              <button 
                type="submit" 
                disabled={isUploading}
                style={{ backgroundColor: '#3b82f6', color: 'white', border: 'none', padding: '16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px', marginTop: '16px', boxShadow: '0 4px 6px rgba(59, 130, 246, 0.2)' }}
              >
                {isUploading ? "Mengunggah & Menyimpan..." : "Kirim Request E-Signature Baru 🎉"}
              </button>
            </form>
          </div>
        )}

        {/* AREA KONTROL: PLOTTING & SIGNING */}
        {mode !== 'upload' && mode !== 'dashboard' && doc && (
          <>
            <div style={{ backgroundColor: 'white', padding: '20px 32px', borderRadius: '16px', boxShadow: '0 2px 4px rgba(0,0,0,0.04)', border: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '22px', color: '#111827' }}>{doc.filename}</h2>
                <p style={{ margin: '6px 0 0 0', color: '#6b7280', fontSize: '14px' }}>
                  {isSignerOnlyView ? `Portal Penandatanganan untuk: ${activeSigner?.name}` : `Mode Aktif: ${mode === 'plotting' ? 'Pengaturan Posisi Kotak' : 'Portal Pengisian Dokumen'}`}
                </p>
              </div>

              {mode === 'signing' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div 
                      style={{ 
                        width: '48px', 
                        height: '48px', 
                        borderRadius: '50%', 
                        background: `conic-gradient(${progressPercent === 100 ? '#10b981' : '#3b82f6'} ${progressPercent * 3.6}deg, #e2e8f0 0deg)`,
                        padding: '4px',
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center'
                      }}
                    >
                      <div style={{
                        width: '100%',
                        height: '100%',
                        backgroundColor: 'white',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 'bold', 
                        fontSize: '12px', 
                        color: progressPercent === 100 ? '#10b981' : '#3b82f6'
                      }}>
                        {progressPercent}%
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '700', color: '#374151' }}>Progress Update</div>
                      <div style={{ fontSize: '12px', color: '#6b7280' }}>{completedCount} dari {recipients.length} Selesai</div>
                    </div>
                  </div>

                  {!isCancelled && activeSigner?.status === 'Mailed' && (
                    <button 
                      onClick={handleFinishSigning}
                      disabled={isSubmitting}
                      style={{ backgroundColor: '#10b981', color: 'white', border: 'none', padding: '12px 24px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', boxShadow: '0 4px 6px rgba(16, 185, 129, 0.2)' }}
                    >
                      {isSubmitting ? "Menyimpan..." : "✓ Selesaikan & Kirim"}
                    </button>
                  )}

                  {progressPercent === 100 && (
                    <button 
                      onClick={handleDownloadFinalPdf}
                      disabled={isDownloading}
                      style={{ backgroundColor: '#0284c7', color: 'white', border: 'none', padding: '12px 24px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', boxShadow: '0 4px 6px rgba(2, 132, 199, 0.3)' }}
                    >
                      {isDownloading ? "Mengolah PDF..." : "📥 Download Signed PDF"}
                    </button>
                  )}
                </div>
              )}
            </div>

            {isCancelled && (
              <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '16px 24px', borderRadius: '12px', fontWeight: '600', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <span style={{ fontSize: '20px' }}>🚫</span> Permintaan tanda tangan untuk dokumen ini telah dibatalkan oleh pengirim.
              </div>
            )}

            <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
              
              {/* KONTROL PANEL */}
              {mode === 'plotting' && (
                <div style={{ width: '320px', backgroundColor: 'white', padding: '24px', borderRadius: '16px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', border: '1px solid #e5e7eb', height: 'fit-content', flexShrink: 0 }}>
                  <h3 style={{ margin: '0 0 20px 0', color: '#111827', fontSize: '18px' }}>Atur Ukuran & Posisi</h3>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                      <label style={{ display: 'block', fontWeight: '600', fontSize: '13px', marginBottom: '8px', color: '#4b5563' }}>Pilih Target Signer:</label>
                      <select 
                        value={selectedRecipientId} 
                        onChange={(e) => setSelectedRecipientId(e.target.value)}
                        style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none', backgroundColor: '#f9fafb' }}
                      >
                        {recipients.map((r) => (
                          <option key={r.id} value={r.id}>
                            Signer {r.signing_order}: {r.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontWeight: '600', fontSize: '13px', marginBottom: '8px', color: '#4b5563' }}>Pilih Tipe Kotak:</label>
                      <select 
                        value={fieldType} 
                        onChange={(e) => setFieldType(e.target.value)}
                        style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none', backgroundColor: '#f9fafb' }}
                      >
                        <option value="signature">✍️ Tanda Tangan</option>
                        <option value="text">📝 Teks Kesimpulan (12pt)</option>
                      </select>
                    </div>
                  </div>

                  {activeBox && (
                    <div style={{ marginTop: '24px', backgroundColor: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                      <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#334155' }}>Sesuaikan Ukuran Kotak Aktif</h4>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <button onClick={() => updateActiveField('width', -20)} style={btnStyle}>Lebar -</button>
                        <button onClick={() => updateActiveField('width', 20)} style={btnStyle}>Lebar +</button>
                        <button onClick={() => updateActiveField('height', -10)} style={btnStyle}>Tinggi -</button>
                        <button onClick={() => updateActiveField('height', 10)} style={btnStyle}>Tinggi +</button>
                      </div>
                    </div>
                  )}

                  <hr style={{ margin: '24px 0', border: 'none', borderTop: '1px solid #e5e7eb' }} />

                  <button 
                    onClick={handleSaveFields}
                    disabled={isSaving}
                    style={{ width: '100%', backgroundColor: '#10b981', color: 'white', border: 'none', padding: '14px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 6px rgba(16, 185, 129, 0.2)' }}
                  >
                    {isSaving ? "Menyimpan..." : "Simpan Posisi & Ukuran"}
                  </button>
                </div>
              )}

              {!isSignerOnlyView && mode === 'signing' && (
                <div style={{ width: '320px', backgroundColor: 'white', padding: '24px', borderRadius: '16px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', border: '1px solid #e5e7eb', height: 'fit-content', flexShrink: 0 }}>
                  <h3 style={{ margin: '0 0 8px 0', color: '#111827', fontSize: '18px' }}>Mode Simulasi Signer</h3>
                  <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 16px 0' }}>Lihat dokumen dari sudut pandang Signer tertentu.</p>
                  
                  <select 
                    value={activeSigner?.id || ''} 
                    onChange={(e) => {
                      const selected = recipients.find(r => r.id === e.target.value)
                      setActiveSigner(selected)
                    }}
                    style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: '600', color: '#1e293b', outline: 'none' }}
                  >
                    {recipients.map((r) => (
                      <option key={r.id} value={r.id}>
                        Signer {r.signing_order}: {r.name} ({r.status})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* AREA DOKUMEN PDF */}
              <div style={{ flex: 1, backgroundColor: '#cbd5e1', padding: '32px', borderRadius: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '80vh', overflowY: 'auto', border: '1px solid #94a3b8', minWidth: '100%' }}>
                <Document file={doc.file_url} onLoadSuccess={({ numPages }) => setNumPages(numPages)}>
                  {Array.from(new Array(numPages || 0), (_, index) => {
                    const pageNo = index + 1
                    return (
                      <div key={pageNo} style={{ marginBottom: '32px', textAlign: 'center' }}>
                        
                        {mode === 'plotting' && (
                          <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc', padding: '8px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', width: '800px', margin: '0 auto 12px auto' }}>
                            <span style={{ fontWeight: '700', fontSize: '13px', color: '#475569' }}>Halaman {pageNo}</span>
                            <button onClick={() => handleAddBox(pageNo)} style={{ backgroundColor: '#3b82f6', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                              + Buat Kotak Disini
                            </button>
                          </div>
                        )}

                        <div 
                          onMouseMove={(e) => handleMouseMove(e, 800, 1100)}
                          style={{ position: 'relative', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)', display: 'inline-block', userSelect: 'none' }}
                        >
                          <Page pageNumber={pageNo} width={800} renderTextLayer={false} renderAnnotationLayer={false} />

                          {fields.filter(f => f.page_number === pageNo).map((f, i) => {
                            const realIndex = fields.findIndex(item => item === f)
                            const isActive = activeFieldIndex === realIndex
                            const targetRecipient = recipients.find(r => r.email === f.recipient_email)
                            
                            const isMyField = activeSigner && activeSigner.email === f.recipient_email
                            const isSigned = targetRecipient?.status === 'Signed'

                            const boxWidth = f.width || (f.field_type === 'text' ? 300 : 180)
                            const boxHeight = f.height || (f.field_type === 'text' ? 80 : 45)

                            const currentTextValue = fieldInputs[f.id] || ''

                            // LOGIKA UKURAN FONT DINAMIS UI
                            const baseFontSizeUI = 18.66; // Setara 14pt
                            const maxTextWidthUI = boxWidth - 12; // padding aman
                            const estTextWidthUI = currentTextValue.length * (baseFontSizeUI * 0.45); // Estimasi proporsi font cursive
                            let sigFontSizeUI = baseFontSizeUI;

                            if (estTextWidthUI > maxTextWidthUI && currentTextValue.length > 0) {
                                sigFontSizeUI = baseFontSizeUI * (maxTextWidthUI / estTextWidthUI);
                            }
                            
                            // Pastikan tidak melebih tinggi kotak
                            sigFontSizeUI = Math.min(sigFontSizeUI, boxHeight * 0.6);

                            return (
                              <div 
                                key={f.id || realIndex}
                                onMouseDown={(e) => mode === 'plotting' && handleMouseDown(e, realIndex)}
                                style={{
                                  position: 'absolute',
                                  left: `${f.x_position}%`,
                                  top: `${f.y_position}%`,
                                  width: `${boxWidth}px`,
                                  height: `${boxHeight}px`,
                                  zIndex: isActive ? 10 : 2
                                }}
                              >
                                {mode === 'plotting' ? (
                                  <div style={{
                                    width: '100%',
                                    height: '100%',
                                    backgroundColor: f.field_type === 'signature' ? 'rgba(59, 130, 246, 0.85)' : 'rgba(139, 92, 246, 0.85)',
                                    border: isActive ? '2px solid #fcd34d' : '1px solid transparent',
                                    color: 'white',
                                    padding: '6px 10px',
                                    borderRadius: '6px',
                                    fontSize: '11px',
                                    cursor: 'grab',
                                    boxSizing: 'border-box',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'space-between',
                                    boxShadow: isActive ? '0 0 0 2px rgba(252, 211, 77, 0.5)' : 'none'
                                  }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                                      <span>{f.field_type === 'signature' ? '✍️ Sign' : '📝 Teks (12pt)'}</span>
                                      <span onClick={(e) => { e.stopPropagation(); removeField(realIndex); }} style={{ cursor: 'pointer', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '50%', width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</span>
                                    </div>
                                    <div style={{ fontSize: '10px', opacity: 0.9 }}>Signer {f.signing_order}: {f.recipient_email}</div>
                                  </div>
                                ) : (
                                  <div style={{ width: '100%', height: '100%' }}>
                                    {isSigned ? (
                                      <div style={{ 
                                        width: '100%', 
                                        height: '100%', 
                                        border: '1.5px solid #16a34a', 
                                        backgroundColor: 'rgba(220, 252, 231, 0.95)', 
                                        color: '#15803d', 
                                        padding: boxHeight < 40 ? '0' : '4px', 
                                        borderRadius: '6px', 
                                        display: 'flex', 
                                        flexDirection: 'column', 
                                        justifyContent: 'center', 
                                        alignItems: 'center', 
                                        textAlign: 'center',
                                        boxSizing: 'border-box', 
                                        overflow: 'hidden',
                                        position: 'relative'
                                      }}>
                                        {f.field_type === 'signature' ? (
                                          <div style={{ 
                                            fontFamily: 'Dancing Script, cursive', 
                                            fontWeight: 'normal',
                                            fontSize: `${sigFontSizeUI}px`, 
                                            lineHeight: '1',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            maxWidth: '100%'
                                          }}>
                                            {currentTextValue}
                                          </div>
                                        ) : (
                                          <div style={{ 
                                            fontSize: boxHeight < 40 ? '10pt' : '12pt', 
                                            fontWeight: 'normal',
                                            wordBreak: 'break-word',
                                            whiteSpace: 'pre-wrap',
                                            width: '100%',
                                            lineHeight: '1.1',
                                            padding: '4px'
                                          }}>
                                            {currentTextValue}
                                          </div>
                                        )}

                                        {boxHeight >= 40 && (
                                          <div style={{ fontSize: '9px', color: '#166534', fontWeight: 'bold', position: 'absolute', bottom: '4px', right: '6px' }}>✓ Signed</div>
                                        )}
                                      </div>
                                    ) : !isCancelled && isMyField && activeSigner?.status === 'Mailed' ? (
                                      <div style={{ width: '100%', height: '100%' }}>
                                        {f.field_type === 'text' ? (
                                          <textarea 
                                            placeholder={`Ketik kesimpulan...`}
                                            value={fieldInputs[f.id] || ''}
                                            onChange={(e) => handleInputChange(f.id, e.target.value)}
                                            style={{ 
                                              width: '100%', 
                                              height: '100%', 
                                              padding: '10px', 
                                              border: '2px solid #3b82f6', 
                                              borderRadius: '6px', 
                                              resize: 'none', 
                                              fontFamily: 'inherit', 
                                              fontSize: '12pt', 
                                              fontWeight: 'normal',
                                              backgroundColor: '#eff6ff', 
                                              boxSizing: 'border-box',
                                              outline: 'none',
                                              boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.2)'
                                            }}
                                          />
                                        ) : (
                                          <input 
                                            type="text"
                                            placeholder={`Ketik Sign...`}
                                            value={fieldInputs[f.id] || ''}
                                            onChange={(e) => handleInputChange(f.id, e.target.value)}
                                            style={{ 
                                              width: '100%', 
                                              height: '100%', 
                                              padding: boxHeight < 40 ? '0' : '4px', 
                                              border: '2px solid #3b82f6', 
                                              borderRadius: '6px', 
                                              fontFamily: 'Dancing Script, cursive', 
                                              fontSize: `${sigFontSizeUI}px`, 
                                              lineHeight: '1',
                                              backgroundColor: '#eff6ff', 
                                              textAlign: 'center', 
                                              fontWeight: 'normal',
                                              color: '#1e40af',
                                              boxSizing: 'border-box',
                                              outline: 'none',
                                              boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.2)'
                                            }}
                                          />
                                        )}
                                      </div>
                                    ) : (
                                      <div style={{ width: '100%', height: '100%', border: '1.5px dashed #cbd5e1', backgroundColor: 'rgba(241, 245, 249, 0.8)', color: '#64748b', padding: '4px', borderRadius: '6px', fontSize: '11px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', boxSizing: 'border-box', cursor: 'not-allowed' }}>
                                        <span style={{ fontWeight: '600' }}>🔒 Kolom {targetRecipient?.name}</span>
                                        <span style={{ fontSize: '9px', opacity: 0.8, marginTop: '4px' }}>Signer {f.signing_order}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </Document>
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  )
}

const menuItemStyle = (isActive) => ({
  cursor: 'pointer',
  padding: '12px 16px',
  borderRadius: '8px',
  backgroundColor: isActive ? 'rgba(56, 189, 248, 0.1)' : 'transparent',
  color: isActive ? '#38bdf8' : '#cbd5e1',
  fontWeight: isActive ? '600' : '500',
  transition: 'all 0.2s ease',
  display: 'flex',
  alignItems: 'center',
  gap: '10px'
})

const dropdownItemStyle = {
  padding: '10px 14px',
  backgroundColor: 'white',
  border: 'none',
  borderBottom: '1px solid #f1f5f9',
  cursor: 'pointer',
  textAlign: 'left',
  fontSize: '13px',
  fontWeight: '600',
  color: '#334155',
  width: '100%',
  display: 'block'
}

const btnStyle = {
  backgroundColor: '#f1f5f9',
  border: '1px solid #cbd5e1',
  color: '#475569',
  padding: '6px',
  borderRadius: '6px',
  cursor: 'pointer',
  fontWeight: '600',
  fontSize: '12px'
}

export default App