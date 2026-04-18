export default function Vendors() {
  return (
    <main className="p-10">
      <h1 className="text-3xl font-bold mb-6">Available Vendors</h1>

      <div className="space-y-4 max-w-xl">

        <div className="bg-white p-6 rounded-xl shadow">
          <h2 className="font-semibold">ABC Plumbing</h2>
          <p className="text-gray-500">⭐ 4.8 rating</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow">
          <h2 className="font-semibold">Elite Electric</h2>
          <p className="text-gray-500">⭐ 4.7 rating</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow">
          <h2 className="font-semibold">Rapid HVAC</h2>
          <p className="text-gray-500">⭐ 4.9 rating</p>
        </div>

      </div>
    </main>
  )
  
}