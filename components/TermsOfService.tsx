import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Shield, FileText } from 'lucide-react';

const TermsOfService: React.FC = () => {
    return (
        <div className="min-h-screen bg-nortex-900 text-slate-300">
            {/* Header */}
            <div className="bg-nortex-800/50 border-b border-slate-700/50 sticky top-0 z-10 backdrop-blur-lg">
                <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
                    <Link to="/" className="text-slate-400 hover:text-white transition-colors">
                        <ArrowLeft size={20} />
                    </Link>
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-nortex-accent rounded-lg flex items-center justify-center">
                            <span className="font-bold text-nortex-900 text-sm">N</span>
                        </div>
                        <span className="font-bold text-white">NORTEX</span>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-4xl mx-auto px-6 py-12">
                <div className="flex items-center gap-3 mb-8">
                    <FileText className="text-nortex-accent" size={28} />
                    <h1 className="text-3xl font-bold text-white">Términos de Servicio</h1>
                </div>
                <p className="text-slate-500 text-sm mb-8">Última actualización: 12 de febrero de 2026</p>

                <div className="space-y-8 leading-relaxed">
                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">1. Aceptación de los Términos</h2>
                        <p>Al registrarse, acceder o utilizar la plataforma NORTEX ("el Servicio"), operada por NORTEX INC. ("nosotros", "la Empresa"), usted ("el Usuario", "el Cliente") acepta estar vinculado por estos Términos de Servicio. Si no está de acuerdo con alguna parte de estos términos, no debe usar el Servicio.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">2. Descripción del Servicio</h2>
                        <p>NORTEX es una plataforma SaaS (Software como Servicio) de gestión financiera y operativa diseñada para pequeñas y medianas empresas en Latinoamérica. El Servicio incluye, pero no se limita a:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>Punto de Venta (POS) con soporte para lectores de código de barras</li>
                            <li>Gestión de inventario con sistema Kardex</li>
                            <li>Facturación y cuentas por cobrar</li>
                            <li>Gestión de recursos humanos y nómina</li>
                            <li>Reportes financieros y fiscales</li>
                            <li>Cotizaciones y gestión de clientes</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">3. Registro y Cuentas</h2>
                        <p>Para utilizar el Servicio, usted debe:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>Proporcionar información veraz, precisa y completa durante el registro.</li>
                            <li>Mantener la seguridad de su contraseña y credenciales de acceso.</li>
                            <li>Notificar inmediatamente cualquier uso no autorizado de su cuenta.</li>
                            <li>Ser mayor de 18 años o tener la capacidad legal para celebrar contratos.</li>
                        </ul>
                        <p className="mt-2">Usted es responsable de todas las actividades que ocurran bajo su cuenta.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">4. Planes y Pagos</h2>
                        <p>El Servicio se ofrece mediante suscripción mensual. Los términos de pago son:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>El costo de la suscripción se factura mensualmente por adelantado.</li>
                            <li>Los pagos se procesan a través de Stripe o mediante depósito/transferencia bancaria.</li>
                            <li>En caso de impago, el acceso a funciones de escritura (ventas, inventario) será suspendido. El acceso de lectura (reportes, consultas) se mantiene.</li>
                            <li>No se realizan reembolsos por períodos parciales de uso.</li>
                            <li>Nos reservamos el derecho de modificar los precios con 30 días de aviso previo.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">5. Uso Aceptable</h2>
                        <p>El Usuario se compromete a no:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>Usar el Servicio para actividades ilegales o fraudulentas.</li>
                            <li>Intentar acceder a cuentas o datos de otros usuarios.</li>
                            <li>Realizar ingeniería inversa, descifrar o descompilar el software.</li>
                            <li>Cargar contenido malicioso, virus o código dañino.</li>
                            <li>Sobrecargar intencionalmente los servidores o infraestructura.</li>
                            <li>Revender el acceso al Servicio sin autorización escrita.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">6. Propiedad de los Datos</h2>
                        <p>Usted mantiene la propiedad total de todos los datos que ingresa al Servicio, incluyendo información de clientes, productos, ventas, empleados y registros financieros. NORTEX no reclama propiedad sobre sus datos comerciales.</p>
                        <p className="mt-2">Usted nos otorga una licencia limitada para procesar, almacenar y mostrar sus datos únicamente con el propósito de proveer el Servicio.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">7. Disponibilidad del Servicio</h2>
                        <p>Nos esforzamos por mantener una disponibilidad del 99.5%. Sin embargo, no garantizamos un servicio ininterrumpido. Se podrán realizar mantenimientos programados con aviso previo de al menos 24 horas. No seremos responsables por interrupciones causadas por terceros, fuerza mayor o eventos fuera de nuestro control.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">8. Limitación de Responsabilidad</h2>
                        <p>NORTEX no será responsable por:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>Pérdidas derivadas de decisiones comerciales basadas en los reportes del sistema.</li>
                            <li>Daños indirectos, incidentales o consecuentes.</li>
                            <li>Pérdida de datos causada por negligencia del usuario.</li>
                            <li>Interrupciones de servicio por causas de fuerza mayor.</li>
                        </ul>
                        <p className="mt-2">Nuestra responsabilidad total acumulada no excederá el monto pagado por el usuario en los últimos 3 meses de servicio.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">9. Cancelación</h2>
                        <p>El Usuario puede cancelar su suscripción en cualquier momento desde la sección de Facturación. Al cancelar:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>El acceso se mantiene hasta el final del período pagado.</li>
                            <li>Los datos del usuario se conservan por 30 días después de la cancelación.</li>
                            <li>Después de 30 días, los datos podrán ser eliminados permanentemente.</li>
                            <li>El usuario puede solicitar una exportación de sus datos antes de la eliminación.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">10. Modificaciones</h2>
                        <p>Nos reservamos el derecho de modificar estos Términos en cualquier momento. Los cambios significativos serán notificados con al menos 15 días de anticipación mediante la plataforma o correo electrónico. El uso continuado del Servicio después de la notificación constituye aceptación de los nuevos términos.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">11. Ley Aplicable</h2>
                        <p>Estos Términos se rigen por las leyes de la República de Nicaragua. Cualquier disputa se resolverá mediante arbitraje en la ciudad de Managua, conforme a las reglas del Centro de Mediación y Arbitraje de la Cámara de Comercio de Nicaragua.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">12. Contacto</h2>
                        <p>Para consultas sobre estos Términos:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>Email: <span className="text-nortex-accent">legal@somosnortex.com</span></li>
                            <li>Web: <span className="text-nortex-accent">https://somosnortex.com</span></li>
                        </ul>
                    </section>
                </div>

                {/* Footer Links */}
                <div className="mt-12 pt-8 border-t border-slate-700/50 flex flex-wrap gap-6 text-sm">
                    <Link to="/privacy" className="text-nortex-accent hover:underline">Política de Privacidad</Link>
                    <Link to="/" className="text-slate-500 hover:text-white transition-colors">Volver al inicio</Link>
                </div>
            </div>
        </div>
    );
};

export default TermsOfService;
