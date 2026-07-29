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

  // Mode: 'dashboard', 'upload', 'plotting', 'signing'
  const [mode, setMode] = useState('dashboard')

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
      // 1. Hapus record dokumen dari database Supabase (recipients & fields akan ikut terhapus jika di-cascade, atau dihapus manual)
      const { error: dbError } = await supabase
        .from('documents')
        .delete()
        .eq('id', docId)

      if (dbError) throw dbError

      // 2. Jika ada URL file storage, hapus filenya dari Supabase Storage
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

        // BACA PARAMETER DARI URL LINK EMAIL
        const queryParams = new URLSearchParams(window.location.search)
        const urlMode = queryParams.get('mode')
        const urlEmail = queryParams.get('email')

        if (urlMode === 'signing' && urlEmail) {
          const matchedSigner = recData.find(r => r.email.toLowerCase() === urlEmail.toLowerCase())
          if (matchedSigner) {
            setActiveSigner(matchedSigner)
            setMode('signing')
            setIsSignerOnlyView(true) // SEMBUNYIKAN SIDEBAR NAVIGASI UNTUK SIGNER
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
      }
    }
  }

  // --- FUNGSI PENGIRIMAN EMAIL DENGAN DIRECT LINK ---
  const sendSigningNotificationEmail = (signerName, signerEmail, documentName) => {
    const directSigningLink = `${window.location.origin}/?mode=signing&email=${encodeURIComponent(signerEmail)}`

    const templateParams = {
      to_name: signerName,
      to_email: signerEmail,
      document_name: documentName,
      signing_link: directSigningLink
    }

    emailjs.send(
      'service_zbpxi9e',   // <--- Service ID EmailJS
      'template_41gdynq',  // <--- Template ID EmailJS
      templateParams,
      '3IVexZ_5CRpEngvvd'    // <--- Public Key EmailJS
    )
    .then((response) => {
      console.log('✅ Email notifikasi berhasil dikirim ke ' + signerEmail, response.status, response.text)
    })
    .catch((err) => {
      console.error('❌ Gagal mengirim email notifikasi:', err)
    })
  }

  // --- LOGIKA FORM UPLOAD DOKUMEN BARU ---
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
        .insert([{ filename: file.name, file_url: publicUrl }])
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

      alert("Berhasil mengunggah dokumen & mendaftarkan Signer baru! Email notifikasi telah dikirim. 🎉")
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

  // --- LOGIKA PLOTTING (FORM BUILDER) ---
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

  // --- LOGIKA SIGNING PORTAL ---
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

      const nextOrder = activeSigner.signing_order + 1
      const nextSigner = recipients.find(r => r.signing_order === nextOrder)

      if (nextSigner) {
        await supabase.from('recipients').update({ status: 'Mailed' }).eq('id', nextSigner.id)
        sendSigningNotificationEmail(nextSigner.name, nextSigner.email, doc.filename)
      }

      alert(`Terima kasih ${activeSigner.name}, dokumen Anda berhasil disimpan! Notifikasi email telah dikirim ke Signer berikutnya. 🎉`)
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

        const xPos = (f.x_position / 100) * pdfWidth
        const yPos = pdfHeight - ((f.y_position / 100) * pdfHeight) - ((f.height || 40) * (pdfHeight / 1100))

        const textToDraw = fieldInputs[f.id] || ''

        if (textToDraw) {
          pdfPage.drawText(textToDraw, {
            x: xPos + 5,
            y: yPos + 10,
            size: f.field_type === 'signature' ? 14 : 11,
            font: helveticaRegular,
            color: f.field_type === 'signature' ? rgb(0.1, 0.25, 0.7) : rgb(0.1, 0.1, 0.1),
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

  const completedCount = recipients.filter(r => r.status === 'Signed').length
  const progressPercent = recipients.length > 0 ? Math.round((completedCount / recipients.length) * 100) : 0
  const activeBox = activeFieldIndex !== null ? fields[activeFieldIndex] : null

  return (
    <div className="app-container" onMouseUp={handleMouseUp} style={{ display: 'flex', minHeight: '100vh' }}>
      
      {/* SIDEBAR NAVIGATION */}
      {!isSignerOnlyView && (
        <div className="sidebar" style={{ width: '240px', backgroundColor: '#1e293b', color: 'white', padding: '20px' }}>
          <h2 style={{ fontSize: '22px', marginBottom: '30px' }}>E-Sign Well</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <li className={mode === 'dashboard' ? 'active' : ''} onClick={() => setMode('dashboard')} style={menuItemStyle(mode === 'dashboard')}>
              📁 All Documents
            </li>
            <li className={mode === 'upload' ? 'active' : ''} onClick={() => setMode('upload')} style={menuItemStyle(mode === 'upload')}>
              ➕ Upload Dokumen Baru
            </li>
            <li className={mode === 'plotting' ? 'active' : ''} onClick={() => setMode('plotting')} style={menuItemStyle(mode === 'plotting')}>
              📐 Plotting Fields
            </li>
            <li className={mode === 'signing' ? 'active' : ''} onClick={() => setMode('signing')} style={menuItemStyle(mode === 'signing')}>
              ✍️ Signing Portal
            </li>
          </ul>
        </div>
      )}

      <div className="main-content" style={{ flex: 1, padding: '25px', display: 'flex', flexDirection: 'column', gap: '20px', backgroundColor: '#f8fafc' }}>
        
        {/* TABEL DASHBOARD "ALL DOCUMENTS" */}
        {!isSignerOnlyView && mode === 'dashboard' && (
          <div style={{ backgroundColor: 'white', padding: '25px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0, fontSize: '22px' }}>All Documents</h2>
              <button 
                onClick={() => setMode('upload')}
                style={{ backgroundColor: '#10b981', color: 'white', border: 'none', padding: '10px 18px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                + Upload New Document
              </button>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '2px solid #e2e8f0', color: '#475569' }}>
                  <th style={{ padding: '12px' }}>DOCUMENT NAME</th>
                  <th style={{ padding: '12px' }}>RECIPIENT EMAILS</th>
                  <th style={{ padding: '12px' }}>DATE CREATED</th>
                  <th style={{ padding: '12px' }}>STATUS</th>
                  <th style={{ padding: '12px', textAlign: 'center' }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {allDocuments.map((d) => {
                  const isAllSigned = d.recipients && d.recipients.length > 0 && d.recipients.every(r => r.status === 'Signed')

                  return (
                    <tr key={d.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '12px', fontWeight: 'bold', color: '#1e293b' }}>{d.filename}</td>
                      <td style={{ padding: '12px', color: '#64748b' }}>
                        {d.recipients?.map(r => r.email).join(', ') || '-'}
                      </td>
                      <td style={{ padding: '12px', color: '#64748b' }}>
                        {new Date(d.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td style={{ padding: '12px' }}>
                        {isAllSigned ? (
                          <span style={{ backgroundColor: '#dcfce7', color: '#15803d', padding: '4px 10px', borderRadius: '4px', fontWeight: 'bold', fontSize: '12px' }}>
                            ✓ COMPLETED
                          </span>
                        ) : (
                          <span style={{ backgroundColor: '#ffedd5', color: '#c2410c', padding: '4px 10px', borderRadius: '4px', fontWeight: 'bold', fontSize: '12px' }}>
                            ⏳ IN PROGRESS
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                          <button 
                            onClick={async () => {
                              await loadDocumentData(d.id)
                              setMode('signing')
                            }}
                            style={{ backgroundColor: '#3b82f6', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                          >
                            Buka Portal
                          </button>
                          <button 
                            onClick={() => handleDeleteDocument(d.id, d.file_url)}
                            style={{ backgroundColor: '#ef4444', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                          >
                            Hapus
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}

                {allDocuments.length === 0 && (
                  <tr>
                    <td colSpan="5" style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>
                      Belum ada dokumen yang dikirim.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* MODE 0: FORM UPLOAD DOKUMEN BARU */}
        {!isSignerOnlyView && mode === 'upload' && (
          <div style={{ backgroundColor: 'white', padding: '30px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', maxWidth: '700px', margin: '0 auto', width: '100%' }}>
            <h2>Upload Dokumen & Atur Signer Baru</h2>
            <p style={{ color: '#64748b' }}>Pilih file PDF dan daftarkan Signer untuk memulai proses baru.</p>

            <form onSubmit={handleUploadSubmit} style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px' }}>File PDF Dokumen:</label>
                <input 
                  type="file" 
                  accept="application/pdf" 
                  onChange={(e) => setFile(e.target.files[0])}
                  style={{ padding: '8px', border: '1px solid #cbd5e1', borderRadius: '4px', width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '10px' }}>Daftar Antrean Signer (Berurutan):</label>
                
                {signerList.map((signer, i) => (
                  <div key={i} style={{ display: 'flex', gap: '10px', marginBottom: '10px', alignItems: 'center' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '13px', width: '70px' }}>Signer {i + 1}:</span>
                    <input 
                      type="text" 
                      placeholder="Nama lengkap" 
                      value={signer.name}
                      onChange={(e) => handleSignerChange(i, 'name', e.target.value)}
                      required
                      style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                    />
                    <input 
                      type="email" 
                      placeholder="Alamat Email" 
                      value={signer.email}
                      onChange={(e) => handleSignerChange(i, 'email', e.target.value)}
                      required
                      style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                    />
                    {signerList.length > 1 && (
                      <button 
                        type="button" 
                        onClick={() => removeSignerRow(i)}
                        style={{ backgroundColor: '#ef4444', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        Hapus
                      </button>
                    )}
                  </div>
                ))}

                <button 
                  type="button" 
                  onClick={addSignerRow}
                  style={{ backgroundColor: '#e2e8f0', color: '#1e293b', border: 'none', padding: '8px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', marginTop: '5px' }}
                >
                  + Tambah Signer Berikutnya
                </button>
              </div>

              <button 
                type="submit" 
                disabled={isUploading}
                style={{ backgroundColor: '#10b981', color: 'white', border: 'none', padding: '14px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px', marginTop: '10px' }}
              >
                {isUploading ? "Mengunggah & Menyimpan..." : "Kirim Request E-Signature Baru 🎉"}
              </button>
            </form>
          </div>
        )}

        {/* TOP BAR HEADER */}
        {mode !== 'upload' && mode !== 'dashboard' && doc && (
          <div style={{ backgroundColor: 'white', padding: '15px 25px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '20px' }}>{doc.filename}</h2>
              <p style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '13px' }}>
                {isSignerOnlyView ? `Portal Penandatanganan untuk: ${activeSigner?.name}` : `Mode Aktif: ${mode === 'plotting' ? 'Pengaturan Posisi Kotak' : 'Portal Pengisian Dokumen'}`}
              </p>
            </div>

            {mode === 'signing' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div 
                    style={{ 
                      width: '55px', 
                      height: '55px', 
                      borderRadius: '50%', 
                      background: `conic-gradient(${progressPercent === 100 ? '#10b981' : '#3b82f6'} ${progressPercent * 3.6}deg, #e2e8f0 0deg)`,
                      padding: '5px',
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
                      fontSize: '13px', 
                      color: progressPercent === 100 ? '#10b981' : '#3b82f6'
                    }}>
                      {progressPercent}%
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 'bold' }}>Progress Complete</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>{completedCount} dari {recipients.length} Signer</div>
                  </div>
                </div>

                {activeSigner?.status === 'Mailed' && (
                  <button 
                    onClick={handleFinishSigning}
                    disabled={isSubmitting}
                    style={{ backgroundColor: '#10b981', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}
                  >
                    {isSubmitting ? "Menyimpan..." : "✓ Selesaikan & Kirim"}
                  </button>
                )}

                {progressPercent === 100 && (
                  <button 
                    onClick={handleDownloadFinalPdf}
                    disabled={isDownloading}
                    style={{ backgroundColor: '#0284c7', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', boxShadow: '0 4px 6px rgba(2, 132, 199, 0.3)' }}
                  >
                    {isDownloading ? "Mengolah PDF..." : "📥 Download Signed PDF"}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* AREA DOKUMEN & KONTROL */}
        {mode !== 'upload' && mode !== 'dashboard' && (
          <div style={{ display: 'flex', gap: '20px' }}>
            
            {/* PANEL KONTROL PLOTTING */}
            {mode === 'plotting' && (
              <div style={{ width: '300px', backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', height: 'fit-content' }}>
                <h3>Atur Ukuran & Posisi</h3>
                
                <div style={{ marginTop: '10px' }}>
                  <label style={{ display: 'block', fontWeight: 'bold', fontSize: '12px', marginBottom: '4px' }}>Target Signer:</label>
                  <select 
                    value={selectedRecipientId} 
                    onChange={(e) => setSelectedRecipientId(e.target.value)}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', marginBottom: '12px' }}
                  >
                    {recipients.map((r) => (
                      <option key={r.id} value={r.id}>
                        Signer {r.signing_order}: {r.name}
                      </option>
                    ))}
                  </select>

                  <label style={{ display: 'block', fontWeight: 'bold', fontSize: '12px', marginBottom: '4px' }}>Tipe Kotak:</label>
                  <select 
                    value={fieldType} 
                    onChange={(e) => setFieldType(e.target.value)}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                  >
                    <option value="signature">✍️ Tanda Tangan</option>
                    <option value="text">📝 Teks Kesimpulan (12pt)</option>
                  </select>
                </div>

                {activeBox && (
                  <div style={{ marginTop: '15px', backgroundColor: '#f8fafc', padding: '10px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                    <h4 style={{ margin: '0 0 8px 0', fontSize: '12px' }}>Sesuaikan Ukuran Kotak</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                      <button onClick={() => updateActiveField('width', -20)} style={btnStyle}>Lebar -</button>
                      <button onClick={() => updateActiveField('width', 20)} style={btnStyle}>Lebar +</button>
                      <button onClick={() => updateActiveField('height', -10)} style={btnStyle}>Tinggi -</button>
                      <button onClick={() => updateActiveField('height', 10)} style={btnStyle}>Tinggi +</button>
                    </div>
                  </div>
                )}

                <hr style={{ margin: '20px 0', border: 'none', borderTop: '1px solid #e2e8f0' }} />

                <button 
                  onClick={handleSaveFields}
                  disabled={isSaving}
                  style={{ width: '100%', backgroundColor: '#10b981', color: 'white', border: 'none', padding: '12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
                >
                  {isSaving ? "Menyimpan..." : "Simpan Posisi & Ukuran"}
                </button>
              </div>
            )}

            {/* SIMULATOR SIGNER */}
            {!isSignerOnlyView && mode === 'signing' && (
              <div style={{ width: '280px', backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', height: 'fit-content' }}>
                <h3>Mode Simulasi Signer</h3>
                <p style={{ fontSize: '12px', color: '#64748b' }}>Pilih siapa yang sedang membuka portal saat ini:</p>
                
                <select 
                  value={activeSigner?.id || ''} 
                  onChange={(e) => {
                    const selected = recipients.find(r => r.id === e.target.value)
                    setActiveSigner(selected)
                  }}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontWeight: 'bold' }}
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
            <div style={{ flex: 1, backgroundColor: '#cbd5e1', padding: '25px', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '80vh', overflowY: 'auto' }}>
              
              {doc && (
                <Document file={doc.file_url} onLoadSuccess={({ numPages }) => setNumPages(numPages)}>
                  {Array.from(new Array(numPages || 0), (_, index) => {
                    const pageNo = index + 1
                    return (
                      <div key={pageNo} style={{ marginBottom: '25px', textAlign: 'center' }}>
                        
                        {mode === 'plotting' && (
                          <div style={{ marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f1f5f9', padding: '4px 12px', borderRadius: '4px' }}>
                            <span style={{ fontWeight: 'bold', fontSize: '12px' }}>Halaman {pageNo}</span>
                            <button onClick={() => handleAddBox(pageNo)} style={{ backgroundColor: '#3b82f6', color: 'white', border: 'none', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>
                              + Buat Kotak
                            </button>
                          </div>
                        )}

                        <div 
                          onMouseMove={(e) => handleMouseMove(e, 800, 1100)}
                          style={{ position: 'relative', boxShadow: '0 10px 20px rgba(0,0,0,0.15)', display: 'inline-block', userSelect: 'none' }}
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
                                    border: isActive ? '2px solid #f59e0b' : '1px solid transparent',
                                    color: 'white',
                                    padding: '4px 8px',
                                    borderRadius: '4px',
                                    fontSize: '11px',
                                    cursor: 'grab',
                                    boxSizing: 'border-box',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'space-between'
                                  }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                      <span>{f.field_type === 'signature' ? '✍️ Sign' : '📝 Teks (12pt)'}</span>
                                      <span onClick={(e) => { e.stopPropagation(); removeField(realIndex); }} style={{ cursor: 'pointer' }}>✕</span>
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
                                        padding: '8px', 
                                        borderRadius: '4px', 
                                        display: 'flex', 
                                        flexDirection: 'column', 
                                        justifyContent: 'flex-start', 
                                        alignItems: 'flex-start', 
                                        textAlign: 'left',
                                        boxSizing: 'border-box', 
                                        overflow: 'hidden' 
                                      }}>
                                        {f.field_type === 'signature' ? (
                                          <div style={{ 
                                            fontFamily: 'Dancing Script, cursive', 
                                            fontWeight: 'normal',
                                            fontSize: `${Math.min(boxHeight * 0.45, 18)}px`, 
                                            lineHeight: '1.2',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            maxWidth: '100%'
                                          }}>
                                            {currentTextValue}
                                          </div>
                                        ) : (
                                          <div style={{ 
                                            fontSize: '12pt', 
                                            fontWeight: 'normal',
                                            wordBreak: 'break-word',
                                            whiteSpace: 'pre-wrap',
                                            width: '100%'
                                          }}>
                                            {currentTextValue}
                                          </div>
                                        )}

                                        <div style={{ fontSize: '8px', color: '#166534', fontWeight: 'bold', marginTop: 'auto' }}>✓ Signed</div>
                                      </div>
                                    ) : isMyField && activeSigner?.status === 'Mailed' ? (
                                      
                                      <div style={{ width: '100%', height: '100%' }}>
                                        {f.field_type === 'text' ? (
                                          <textarea 
                                            placeholder={`Ketik kesimpulan di sini...`}
                                            value={fieldInputs[f.id] || ''}
                                            onChange={(e) => handleInputChange(f.id, e.target.value)}
                                            style={{ 
                                              width: '100%', 
                                              height: '100%', 
                                              padding: '8px', 
                                              border: '2px solid #3b82f6', 
                                              borderRadius: '4px', 
                                              resize: 'none', 
                                              fontFamily: 'inherit', 
                                              fontSize: '12pt', 
                                              fontWeight: 'normal',
                                              backgroundColor: '#eff6ff', 
                                              boxSizing: 'border-box' 
                                            }}
                                          />
                                        ) : (
                                          <input 
                                            type="text"
                                            placeholder={`Ketik Tanda Tangan...`}
                                            value={fieldInputs[f.id] || ''}
                                            onChange={(e) => handleInputChange(f.id, e.target.value)}
                                            style={{ 
                                              width: '100%', 
                                              height: '100%', 
                                              padding: '4px', 
                                              border: '2px solid #3b82f6', 
                                              borderRadius: '4px', 
                                              fontFamily: 'Dancing Script, cursive', 
                                              fontSize: `${Math.min(boxHeight * 0.45, 18)}px`, 
                                              backgroundColor: '#eff6ff', 
                                              textAlign: 'center', 
                                              fontWeight: 'normal',
                                              color: '#1e40af',
                                              boxSizing: 'border-box' 
                                            }}
                                          />
                                        )}
                                      </div>

                                    ) : (

                                      <div style={{ width: '100%', height: '100%', border: '1.5px dashed #cbd5e1', backgroundColor: 'rgba(241, 245, 249, 0.75)', color: '#64748b', padding: '4px', borderRadius: '4px', fontSize: '10px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', boxSizing: 'border-box', cursor: 'not-allowed' }}>
                                        <span style={{ fontWeight: 'normal' }}>🔒 Kolom {targetRecipient?.name}</span>
                                        <span style={{ fontSize: '8px', opacity: 0.8 }}>Signer {f.signing_order}</span>
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
              )}

            </div>

          </div>
        )}

      </div>
    </div>
  )
}

const menuItemStyle = (isActive) => ({
  cursor: 'pointer',
  padding: '10px 12px',
  borderRadius: '6px',
  backgroundColor: isActive ? '#3b82f6' : 'transparent',
  fontWeight: isActive ? 'bold' : 'normal'
})

const btnStyle = {
  backgroundColor: '#e2e8f0',
  border: 'none',
  padding: '6px',
  borderRadius: '4px',
  cursor: 'pointer',
  fontWeight: 'bold',
  fontSize: '12px'
}

export default App